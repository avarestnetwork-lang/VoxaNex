/**
 * ChatLustora — Session-Aware Room Join Regression Tests
 *
 * These source-level checks verify that active sessions navigate directly to
 * the selected room, unauthenticated visitors retain the entry flow, room
 * destinations survive entry-tab navigation, and existing access guards remain.
 *
 * Run: npx tsx tests/room_join_flow_test.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

let assertions = 0;
let failures = 0;

function assert(condition: boolean, name: string): void {
  assertions += 1;
  if (condition) {
    console.log(`[PASS] ${name}`);
  } else {
    failures += 1;
    console.error(`[FAIL] ${name}`);
  }
}

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(root, relativePath), 'utf8');

const directory = read('src/pages/RoomDirectoryPage.tsx');
const landing = read('src/pages/RoomLandingPage.tsx');
const guestEntry = read('src/pages/GuestEntryPage.tsx');
const chat = read('src/pages/PublicChatPage.tsx');
const app = read('src/App.tsx');

assert(
  directory.includes('const { hasActiveSession, is18Verified, ageDeclarationAccepted, user } = useAuth();'),
  'Room directory reads the authoritative active-session state'
);
assert(
  directory.includes("if (hasActiveSession) {\n      navigate('/chat', { roomId: room.slug });\n      return;"),
  'Active guest/member sessions join the selected room directly from the directory'
);
assert(
  directory.includes("navigate('/user/guest-entry', { targetRoom: room.slug });"),
  'Visitors without a session retain the guest/member entry flow and target room'
);
assert(
  landing.includes("import { useAuth } from '../context/AuthContext';") &&
    landing.includes('const { hasActiveSession } = useAuth();'),
  'Room landing page uses the shared authentication state'
);
assert(
  landing.includes("navigate('/chat', { roomId: room.slug });") &&
    landing.includes("navigate('/user/guest-entry', { targetRoom: room.slug });"),
  'Room landing Join action selects direct chat or entry flow based on session state'
);
assert(
  guestEntry.includes('const routeParams = targetRoom ? { targetRoom: targetRoom.slug } : undefined;') &&
    guestEntry.includes("navigate('/user/register', routeParams);") &&
    guestEntry.includes("navigate('/user/login', routeParams);") &&
    guestEntry.includes("navigate('/user/guest-entry', routeParams);"),
  'Selected room destination is preserved when switching guest/login/register tabs'
);
assert(
  chat.includes('if (!hasActiveSession) {') &&
    chat.includes('if (activeRoom.is18Plus && !hasAgeAccess) {'),
  'Chat page retains unauthenticated-session and 18+ access guards'
);
assert(
  app.includes("case '/chat':") &&
    app.includes('return hasActiveSession ? (') &&
    app.includes('<PublicChatPage />'),
  'Application route renders the actual chat page for active sessions'
);

console.log(`\\nRoom Join Regression Results: ${assertions - failures}/${assertions} passed; ${failures} failed.`);
if (failures > 0) process.exit(1);
