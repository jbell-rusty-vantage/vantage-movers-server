import fs from 'node:fs';
import path from 'node:path';
import { rootTouchesRepo, normalizePath, isQualityChild } from './util.mjs';

/**
 * Hook events, normalized across tools:
 *   start → session opened (no trigger), busy → a prompt was submitted,
 *   idle → a turn ended (trigger), end → session ended (trigger),
 *   interrupt → turn cut short (no trigger).
 */
export const EVENTS = ['start', 'busy', 'idle', 'end', 'interrupt'];

/**
 * Pure decision for one hook invocation: whether to act, and the session update.
 * `provider` is the tool whose registration fired; the payload/env reveal the host.
 */
export function decideHook({ provider, event, payload = {}, env = {} }) {
  if (isQualityChild(env)) return { act: false, why: 'quality child' };
  if (!EVENTS.includes(event)) return { act: false, why: `unknown event ${event}` };
  const cursorHost = Boolean(payload.cursor_version || env.CURSOR_VERSION);
  // Cursor also runs Claude Code (third-party) hooks; its own registration handles the event.
  if (provider !== 'cursor' && cursorHost) return { act: false, why: `${provider} registration inside Cursor` };
  if (event === 'idle' && (Number(payload.loop_count) > 0 || payload.stop_hook_active === true)) return { act: false, why: 'stop-hook loop' };
  const session = String(payload.session_id || payload.conversation_id || 'unknown');
  const roots = [...new Map([payload.cwd, ...(Array.isArray(payload.workspace_roots) ? payload.workspace_roots : []), env.CURSOR_PROJECT_DIR, env.CLAUDE_PROJECT_DIR]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.replace(/^\/([a-zA-Z])\//, '$1:/'))
    .map(value => [normalizePath(value), value])).values()];
  const state = { start: 'started', busy: 'busy', idle: 'idle', end: 'ended', interrupt: 'interrupted' }[event];
  return { act: true, session, roots, state, trigger: event === 'idle' || event === 'end' };
}

export function sessionFile(home, provider, session) {
  return path.join(home, 'sessions', `${provider}-${session.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

/** Unshown notices for repositories this session touches (once per run per session). */
export function pendingNotices(home, roots, shown = [], { now = Date.now(), maxAgeHours = 24 } = {}) {
  const directory = path.join(home, 'notices');
  if (!fs.existsSync(directory)) return [];
  const notices = [];
  for (const name of fs.readdirSync(directory).filter(file => file.endsWith('.json'))) {
    try {
      const notice = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      if (shown.includes(notice.id) || now - notice.at > maxAgeHours * 3_600_000) continue;
      if (roots.some(root => rootTouchesRepo(root, notice.repo))) notices.push(notice);
    } catch { /* a notice being written is picked up next time */ }
  }
  return notices.sort((a, b) => a.at - b.at);
}

/** Hook stdout for each tool. Only session start and prompt submit can carry context. */
export function hookOutput(provider, event, payload, text) {
  if (!text) return {};
  if (provider === 'cursor') return event === 'start' ? { additional_context: text } : {};
  if (event !== 'start' && event !== 'busy') return {};
  return { hookSpecificOutput: { hookEventName: payload.hook_event_name || (event === 'start' ? 'SessionStart' : 'UserPromptSubmit'), additionalContext: text } };
}
