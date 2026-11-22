# Security Specification — Curacao Mileage

## 1. Data Invariants
1. **PII Isolation**: `/users/{userId}` contains employee name, employee ID, manager email, and home store. Only the verified owner (`request.auth.uid == userId && email_verified == true`) can read or write it. List queries are forbidden.
2. **Ownership Integrity**: Every document in `/trips`, `/templates`, and `/reports` requires `userId == request.auth.uid`, validated on create, list, get, update, and delete. `userId` and creation timestamps are immutable.
3. **Terminal State Locking**:
   - Once a trip in `/trips/{tripId}` transitions from `status: 'ready'` to `status: 'submitted'`, it can never be edited, reverted, or deleted.
   - Once a report in `/reports/{reportId}` transitions from `status: 'submitted'` to `status: 'reimbursed'`, it is permanently locked.
4. **Atomicity Guarantee**: A trip can only transition to `status: 'submitted'` if `existsAfter(/databases/$(database)/documents/reports/$(incoming().reportId))` holds and that report belongs to the same `request.auth.uid`.
5. **Temporal Integrity**: `createdAt`, `submittedAt`, and `updatedAt` must equal `request.time` on creation/update; client-forged timestamps are rejected.
6. **Strict Schema & Size Bounds**: Every document enforces exact `hasAll` + `hasOnly` key checks, string `.size()` limits verbatim from `firebase-blueprint.json`, numeric range guards, and `isValidId()` regex validation on document IDs.

## 2. The "Dirty Dozen" Attack Payloads (Expected: PERMISSION_DENIED)
1. **Identity Spoofing (Create Trip for Another User)**: `{ userId: "victim-uid", ... }` by `attacker-uid`.
2. **Shadow Field Injection (User Profile)**: Adding `isAdmin: true` to `/users/{uid}` create or update.
3. **Unverified Email Write**: Authenticated user with `email_verified: false` creating a trip.
4. **PII Cross-Read**: `userB` calling `get` on `/users/userA`.
5. **Blanket List Scraping**: Calling `list` on `/trips` without `where('userId', '==', uid)`.
6. **Orphaned Report Submission (Atomicity Bypass)**: Updating a trip to `status: 'submitted', reportId: 'nonexistent-report'` without creating the report in the same batch.
7. **Terminal Trip Tampering**: Editing `billableMiles` or deleting a trip whose existing `status == 'submitted'`.
8. **Terminal Report Tampering**: Reverting a report from `status: 'reimbursed'` back to `'submitted'`.
9. **Client Timestamp Forgery**: Creating a trip with `createdAt` set to a past timestamp instead of `serverTimestamp()`.
10. **ID Poisoning**: Creating a document with a 200-character ID or invalid characters (`../bad$id`).
11. **Value Poisoning (Type/Size Overflow)**: Updating `notes` on a ready trip with a 10KB string or setting `ratePerMile: 999`.
12. **Immutable Field Mutation**: Updating `userId` or `createdAt` on an existing ready trip.
