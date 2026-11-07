# JWT Security Review

## Summary

The server validates JWTs, but valid authentication is not consistently tied to
the user identity authorized to access each book or borrow record. The findings
below allow one signed-in user to act on another user's data.

## Findings

### 1. Book ownership is not enforced

- **Severity:** High
- **Confidence:** 9/10
- **Location:** [`index.js`](./index.js), lines 109, 117-121, and 314-338
- **Issue:** Book creation accepts ownership fields from the request body, while
  book editing and deletion use only the book ID. Any signed-in user can
  attribute a new book to another user or modify/delete a book they do not own.
- **Recommendation:** Set ownership from the verified JWT identity and include
  the owner in edit/delete database filters. Permit access to other owners'
  books only for an explicitly authorized administrator.

### 2. Borrow ownership is not enforced

- **Severity:** Medium
- **Confidence:** 9/10
- **Location:** [`index.js`](./index.js), lines 147-151, 232-235, 241-250,
  and 270-277
- **Issue:** Borrow creation trusts the request body's email, borrow listing
  accepts an email in the URL, and return deletes a record without checking its
  owner. A signed-in user can create a borrow under another user's email, read
  their borrow records, or return their books.
- **Recommendation:** Derive the borrower identity from the verified JWT and
  include that identity in borrow-list and return database queries.

## Review scope

Read-only review of JWT validation and authorization across the BookNook client
and server. No secret values were inspected or included in this report.
