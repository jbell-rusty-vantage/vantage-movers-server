"""Authenticated GET-only Phase 1 production verification; never prints credentials/contact rows."""
import argparse
import datetime
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

BASE = 'https://vantage-movers-main-server.vercel.app'
PREFIX = '/api/v1/admin/sales-outreach'
# Runtime-bound credentials only; never reads a secret file or prints raw records.
# Explicit invocation is required, and redirects cannot forward signed headers elsewhere.
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(NoRedirect())
ALLOWED_GETS = {'configuration', 'capabilities', 'team', 'rep-metrics', 'queue', 'live'}
OBSERVED_GETS=[]
def signed_request(endpoint, query=None, role='owner', agent=None):
    if endpoint not in ALLOWED_GETS:
        raise ValueError('Endpoint is outside the fixed GET verification allowlist')
    if role not in {'owner', 'manager', 'rep', 'admin'}:
        raise ValueError('Unsupported verification role')
    if role == 'rep' and not agent:
        raise ValueError('Rep verification requires the selected Agent')
    path = PREFIX + '/' + endpoint
    request_id, timestamp = str(uuid.uuid4()), str(int(time.time()*1000))
    fields = [os.environ['VANTAGE_ADMIN_USER_ID'].strip(), os.environ['VANTAGE_ADMIN_EMAIL'].strip().lower(), role, timestamp, request_id, 'GET', path]
    if role == 'rep': fields.append(agent)
    headers = {
        'x-api-secret':os.environ['VANTAGE_API_SECRET'],
        'x-vantage-admin-user-id':fields[0], 'x-vantage-admin-email':fields[1],
        'x-vantage-admin-role':role, 'x-vantage-admin-request-id':request_id,
        'x-vantage-admin-timestamp':timestamp,
        'x-vantage-admin-signature':hmac.new(os.environ['VANTAGE_ADMIN_PROXY_SIGNING_SECRET'].encode(), '\n'.join(fields).encode(), hashlib.sha256).hexdigest(),
    }
    if role == 'rep': headers['x-vantage-admin-agent-id']=agent
    url = BASE + path + ('?' + urllib.parse.urlencode(query) if query else '')
    return urllib.request.Request(url, headers=headers, method="GET")

def get(endpoint, query=None, role='owner', agent=None):
    started=time.monotonic()
    try:
        with OPENER.open(signed_request(endpoint,query,role,agent),timeout=45) as response:
            status,body=response.status,json.load(response)
    except urllib.error.HTTPError as error:
        try: body=json.load(error)
        except ValueError: body={}
        status=error.code
    OBSERVED_GETS.append({'endpoint':endpoint,'role':role,'http':status,'elapsed_seconds':round(time.monotonic()-started,3),'query_keys':sorted(query or {})})
    return status,body

def main():
    status, body = get('configuration'); assert status==200
    config=body['data']; mapping={row['code']:row['workflow'] for row in config['value']['cadence']['priority_map']['codes']}
    assert config['revision']==26 and mapping['2']==mapping['3']=='daily'
    assert mapping=={'0':'new','1':'quoted','2':'daily','3':'daily','5':'closed','7':'closed','8':'closed'}
    policy=config['value']['cadence']['priority_map']
    assert policy['unmapped_workflow']=='none' and policy['official_booking_workflow']=='closed'
    status, body=get('capabilities'); assert status==200 and 'rep_metrics' in body['data']['deployed_reads']
    status, body=get('team'); assert status==200
    team=body['data']; reps=team.get('daily_call_goals',[])
    assert reps, 'No current Rep available for verification'
    rep_ids={rep['agent_id'] for rep in reps}
    attention=team.get('leads_needing_attention',{}).get('rows') or []
    agent=next((row['assigned_agent_id'] for row in attention if row.get('assigned_agent_id') in rep_ids and row.get('move_date')),reps[0]['agent_id'])
    foreign=next((r['agent_id'] for r in reps if r['agent_id']!=agent),'000000000000000000000000')
    money=[]
    for role, query in [('owner',{'agent_id':agent}),('manager',{'agent_id':agent}),('rep',{})]:
        status, body=get('rep-metrics',query,role,agent)
        assert status==200,(role,status,body.get('code'))
        data=body['data']; assert data['agent_id']==agent
        assert data['official_binder']['basis']=='gross_own_allocation'
        assert data['assigned_potential']['basis']=='current_assignment_attached_booking_total'
        assert all(data['official_binder'][key]>=0 for key in ['today','last_week','last_month','all_time'])
        current=datetime.datetime.now(ZoneInfo('America/New_York')).date()
        week_start=current-datetime.timedelta(days=current.weekday()+7)
        month_end=current.replace(day=1)-datetime.timedelta(days=1)
        expected={'today':{'from':str(current),'to':str(current)},'last_week':{'from':str(week_start),'to':str(week_start+datetime.timedelta(days=6))},'last_month':{'from':str(month_end.replace(day=1)),'to':str(month_end)}}
        assert data['official_binder']['windows']==expected
        assert data['business_day']==str(current)
        money.append(data)
    status,_=get('rep-metrics',{'agent_id':foreign},'rep',agent); assert status==403
    status,_=get('rep-metrics',{'agent_id':agent},'admin'); assert status==403
    status,_=get('rep-metrics'); assert status==400
    today=datetime.datetime.now(ZoneInfo('America/New_York')).date(); yesterday=today-datetime.timedelta(days=1)
    queues={}
    for label, extra in [('all',{}),('future',{'move_date_from':str(today),'move_date_unknown':'exclude'}),('past',{'move_date_to':str(yesterday),'move_date_unknown':'exclude'}),('unknown',{'move_date_unknown':'only'})]:
        status,body=get('queue',{'sort':'move_date','state':'all_active','limit':5,**extra}); assert status==200,(label,status)
        rows=body['data']['rows']; dates=[row['move_date'] for row in rows]
        assert dates==sorted((d for d in dates if d is not None))+[None]*dates.count(None)
        if label=='future': assert all(d and d>=str(today) for d in dates)
        if label=='past': assert all(d and d<=str(yesterday) for d in dates)
        if label=='unknown': assert all(d is None for d in dates)
        queues[label]={'scope':'team','sample_rows':len(rows),'ordered_nulls_last':True,'cursor_available':bool(body['data'].get('next_cursor'))}
    potential=money[0]['assigned_potential']
    with OPENER.open(signed_request('live',{'version':1}),timeout=45) as response:
        assert response.status==200 and 'text/event-stream' in response.headers['content-type']
        first_frame=None;clock_frame=None;deadline=time.monotonic()+40
        while time.monotonic()<deadline:
            line=response.readline().decode().strip()
            if line.startswith('data:'):
                frame=json.loads(line[5:].strip())
                if first_frame is None:first_frame=frame
                if frame['reason']=='clock':clock_frame=frame;break
        assert first_frame and first_frame['refetch']=='all' and first_frame['reason']=='connect'
        assert clock_frame and clock_frame['refetch']=='all'
    summary={'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'api_base':BASE,'configuration_revision':config['revision'],'priorities_2_3':'daily','role_checks':{'owner':200,'manager':200,'rep_self':200,'rep_foreign':403,'generic_admin':403,'owner_without_selection':400},'calendar_windows':money[0]['official_binder']['windows'],'official_basis':'gross_own_allocation','potential_basis':'current_assignment_attached_booking_total','selected_rep_coverage':{key:potential[key] for key in ['coverage','eligible_lead_count','linked_booking_count','missing_link_count','dangling_link_count','missing_amount_count','mismatched_link_count','ambiguous_identity_count']},'move_date_reads':queues,'mutations':0}
    summary['live_connection']={'http':200,'first_frame_reason':first_frame['reason'],'refetch':first_frame['refetch'],'clock_frame_reason':clock_frame['reason'],'production_mutation_test':False}
    summary['lifecycle_gates']={'unmapped_workflow':policy['unmapped_workflow'],'official_booking_workflow':policy['official_booking_workflow'],'unchanged_priority_map':True}
    summary['read_timings']=OBSERVED_GETS
    print(json.dumps(summary,indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', help='Perform the fixed, authenticated production GET verification')
    arguments = parser.parse_args()
    if not arguments.run:
        parser.error('--run is required; no request was sent')
    main()
