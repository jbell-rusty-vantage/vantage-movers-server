We are implementing a complete refactor of the vantage movers server api which is built with express mongodb vercel and will be integrated into a postman collection for local and production grade testing before integration into the current sites.

Let me explain some upper level context to help along the way.

We will complete the work in units that build upon each other. We will most likely implement the mongoose schemas, including fields, virtual fields, relationships and possibly query and operation middleware for synchronization and derivation purposes.

The mongo db database is the source of truth and the google sheets that are derived are company owner views and lead source specific views used for reporting and tracking.

We will create server side data structures (maps or objects) holding certain static data including env variable maps for the google sheets ids , the cost per lead per company source, the company source names which are now going to be only one value ( we can add an optional source company site but it is not required)

I am now going to write out the entire mongo db schemas including some to be determined or questionable parts of it. I will try my hardest to include as much metadata about the fields as is needed to construct them with mongoose.

I am also going to write out the structure of each sheet and its tabs and how they are to be produced and synced. I will refer to the sheet id or container as the sheet container and refer to the various sheets within it (the tabs) that actually contain columnar data.

I will also describe a high level flow of exactly how the types of leads enter the system and what happens to them after

---

Happy path and workflow context:

Leads will come from either two sites. The Main Site or a Lead facilitator site. The lead facilitator site will facilitate data that identifies the lead source company. The Leads can be either Form Leads or Call Leads. These Lead types have different fields although their is cross over.

The Leads will be validated , their sheet synchronization status marked and then they will create the sheets in certain ways . They will update a Master Lead sheet and they will update lead company source specific sheets and the fields will be able to produce the sheet columns either exactly or through a post processing step. Sheet columns should be created if they don't exist.

Form Leads will pass on to a CRM and Call Leads will immediately hook into the call system and at this point there are various services that I will hook into and they will hit our servers.

To be clear our server CRUD and post processing steps must handle the data that comes in.

Happy path and workflow content end:

1. Production Database Mongo/Mongoose Schemas and how sheets and their columns are created and updated

Database name: vantagemovers

Schemas and sheet names and sheet column derivations and maps

form_leads
\_id: unique identifier  
source_company: enum string default not_provided (Note that per the company's needs the company source specific sheets will have titles that we keep in a map source_company: source_company_sheet_title)  
name: String Required
source_company_site: string Optional for now.
timestamp: DateTime Required
lid: Optional . Generated as LID + 13 alphanumeric characters or something like that you will see it in the code. we keep this for some backward compatibility possibly when we do a backfill of old leads still in old sheets.
pickup_zip: Number or String a ZipCode Required
destination_zip: Number or String a ZipCode Required
pickup_state: String a State code Required
delivery_state: String a State code Required
move_size: String enum Studio, 2 Bedrooms, 3 Bedrooms, 4 Bedrooms, 5+ Bedrooms, Office Required
move_date: DateTime Optional with a default
ref_no: A String ( it is an identifier that's why I say string) Required
booked: A reference to the booked_leads table .  
over_2000: A boolean referring to whether the deposit amount of the booking was over 2000 Optional
over_4000: A boolean referring to whether the deposit amount of the booking was over 4000 Optional
local: enum of local or out_of_state. You must check whether the pickup_zip and delivery_zip as it comes in is the same state. Required
email: A valid email Optional
phone_number: a valid phone number Required
cpl: We will have a map of source_company: cost per lead (Number) Required
quoted: Boolean Optional  
cancelled: This will be pulled from the cancelled_leads table.
cubic_feet: Number Optional

... all sync fields and statuses for the sheet

Note: We will figure out edge cases and synchronization issues as we go along

The creation or update of a Lead will create (if not exists) the columns of these sheets. The source_company field value will determine the segments. The sheets are actually already named correctly so don't worry about the container name.

You will always update the

MASTER_LEADS_SHEET_ID and update the Forms sheet within it with these columns. The Booked and Cancelled must be derived by checking if their relational joins exist and are valid.

Master Sheet ALL Form Leads and Call Leads . Write these values to the Forms sheet in the Master Lead Sheet Id Container
TimeStamp
Name  
Pickup Zip
Destination Zip
Pickup State
Delivery State
Move Size
Move Date  
Phone Number
Mongo Lead ID  
Phone Number
Ref No  
Booked : Boolean in the sheet(derived from booked_leads join)
OVER 2000  
OVER 4000
Cancelled: Boolean in the sheet (derived from cancelled_leads)  
Local  
Cubic Feet  
Lead ID
Source Company
Source Company Site
Quoted: A Boolean

These columns receive the same data type values obviously. The booked and Cancelled must be derived from the mongo collection by loading the join and checking if exists and valid

Then I need these Sheet ids and the same columns to be created if not exist and updated for each source_company. Some of these sheets, notably the source companies that are not the main site will have 2 extra sheets that need to be created but we don't write to them yet.

WE ALWAYS WRITE ALL form leads to the Forms of the

MASTER_LEADS_SHEET_ID

Now source company specific sheets including the main site one. Source company sheet containers have two additional sheets Bad Leads, Bad Calls. I will tell you how to update those and what columns later on.

TBM_LEADS_SHEET_ID=

TBM_PRIME_LEADS_SHEET_ID=

TOP10_LEADS_SHEET_ID=

BEST_RELOCATION_LEADS_SHEET_ID=

Each of these will have a Forms, Calls, Bad Leads, Bad Calls as sheets within them.

We are only talking about the Forms sheets right now and their column updates which is the same as above for the Master Sheet but need to only contain collection document -> sheet rows that come from that source_company

MAINSITE_LEADS_SHEET_ID=

This sheet will facilitate Form Leads to Forms that have main_site as the source_company. It only has Forms, Calls as sheets

Collection - call_leads
\_id: mongo id unique identifier
timestamp: DateTime required
phone_number: required valid phone number
duration: Optional. length of time of call
start_time: Date Time timestamp Optional
end_time: Date Time timestamp Optional
booked: relationship to the the booked_leads collection  
cancelled: relationship to the cancelled_leads collection  
over_2000: Boolean Optional
over_4000: Boolean Optional  
local: Optional Boolean (signifies whether pickup and delivery in same state)
(NOTE: pick up zip and delivery sip doesn't come through the call lead normal flow and will be updated later on. We'll put optional pickup_zip and delivery_zip even though the booked_leads will contain this info ultimately as well)  
pickup_zip: Optional zip  
delivery_zip: Optional zip
cubic_feet: Number in cubic feet of move size  
cpl: Number / Float . I will provide a map below that will be map to source company
... sheet synchronization fields

Sheet synchronization

now once again those same sheet ids will be written except the Calls sheet and the columns will be created if not exists and updated as follows. The source company specific sheet containers and their Calls will be updated as well containing only call_leads from the specific source companies including the main site .

MASTER_LEAD_SHEET_ID Calls

TBM_PRIME_LEADS_SHEET_ID Calls

TOP10_LEADS_SHEET_ID Calls

BEST_RELOCATION_LEADS_SHEET_ID Calls

MAINSITE_LEADS_SHEET_ID Calls

Columns (create if not exists in the Calls sheet. remember master lead sheet contains ALL call leads in Calls)

Timestamp
Agent
Book Date
Job No
Customer Name (Derive this from the customer relation load)
Binder Amount
Deposit Amount
Merchant
Source
Mongo Id (the \_id from the mongo row )
Local
Cancelled: Boolean derived from whether or not the booking was cancelled

Okay now here are the CPL amounts per source company. The best relocation has two one for leads and one for local leads which we will have to compute based on whether the lead is a local

Here is also the source company names and which sheet they map to . You will be able to create a precise mapping from this.

source company: TBM Leads
CPL: TBM_LEADS_CPL=190
--
source company: TBM Prime Leads
CPL: TBM_PRIME_LEADS_CPL=190
--
source company: Top 10 Leads
CPL:TOP10_LEADS_CPL=190
--
source company: Best Relocation Leads
CPLS:
CPL NOT LOCAL: BEST_RELOCATION_LEADS_CPL=195
CPL Local:BEST_RELOCATION_LOCALS_CPL=40
--
source company: main site
CPL: MAINSITE_CPL=0

Collection booked_leads (Please follow carefully)
\_id: unique mongo identifier
timestamp: timestamp DateTime required
agent: For now a String Required this is the name of an employee which we might model later on  
book_date: DateTime preferably 10/08/2025 style
customer: reference to the customer collection  
binder_amount: Number / Float required
deposit_amount: Number / Float required (Remember this is the value that is used to determine over 2000 and over 4000)
merchant: String for now required  
source: A String for now I am not sure if this is the same company sources so no enum  
local: A boolean (Signifies if pickup zip and delivery zip is the same ) Currently this pulls from either form_leads or call_leads value. We will determine how to ensure this .
cancelled: relation to the cancelled_leads table.
... sheet synchronization fields
AND MAYBE lead_mongo_id:
Sheet Synchronization , Sheet Name and Columns

We will write all Booked_Leads to one main sheet with these columns

MASTER_BOOKED_SHEET_ID Sheet container

Sheet Name: Booked Deals

Columns (Obvious mapping)

Timestamp
Agent
Book Date
Job No  
Customer Name (derived from the customer join load)
Binder Amount
Deposit Amount
Merchant  
Source
Mongo ID (Unique identifier for Mongo Id for the booked document)
Lead Mongo Id
Local
Cancelled

Collection: customers

full_name: Required
phone_number: Required
email: Optional valid email  
booked: join  
cancelled: join

This does not write to a sheet.

There will be other collections later on but let's start here.

---

2. Now I want to discuss the best way form for implementing the server maps for env variables and static values, creating the mongoose schemas with efficient join logic and also discussing which side should own the relationship and any synchronization issues. I want to have standard create, update and delete routes and functionality. This part of the work does not concern search and analytics.

The unique identifier for updating form_leads, call_leads, booked_leads, cancelled_leads will be the in priority order The Mongo Id, LID (might be used during a backfill operation)

IMPORTANT POINT:

As you can foresee I am gonig to utilize this api within current systems and within a new web site build and thus will be able to hit whatever create, patch or delete routes I need. Nonetheless I may want to update the fields on the form_leads or call_leads that depend on the values being inserted into the booked_leads collection such as

booked  
over_2000
over_4000

So a booking when created is going to send in a lead mongo id and this has to match a call_lead or form_lead \_id . I'm sorry I didn't make that clear I am juggling an owner's need and the systems needs.

Maybe we actually need form_lead_mongo_id and call_lead_mongo_id .

WE NOW NEED TO IMPLEMENT THE CRUD Functionality and test the routes and then the sheet creation functionality. We also need to create server side maps where needed and the all the mongo schemas.
