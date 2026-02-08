# Issue Creation Guidelines for Turumba 2.0

> **Audience:** Project Managers, Product Owners, and Non-Technical Stakeholders
> **Purpose:** Create clear, actionable feature requests that the technical team can break down into development tasks

---

## Table of Contents

1. [Why This Matters](#why-this-matters)
2. [Issue Template](#issue-template)
3. [Section-by-Section Guide](#section-by-section-guide)
4. [Examples](#examples)
5. [Common Mistakes](#common-mistakes)
6. [Workflow](#workflow)
7. [Quick Reference](#quick-reference)

---

## Why This Matters

Well-written issues:
- **Reduce delays** - Developers don't need to ask clarifying questions
- **Prevent rework** - Clear acceptance criteria mean fewer misunderstandings
- **Enable accurate estimates** - Technical leads can properly scope the work
- **Improve collaboration** - Everyone understands what "done" looks like

Poorly written issues cause:
- Back-and-forth questions (delays development by days)
- Features built incorrectly (requires rework)
- Scope creep (features grow beyond original intent)
- Frustrated teams (unclear expectations)

---

## Issue Template

Copy this template when creating new issues:

```markdown
## [Category] Feature Name

### Business Goal
Why are we building this? What problem does it solve?

### User Stories
As a [user type],
I want to [action],
So that [benefit].

### Acceptance Criteria
- [ ] Specific, testable outcome 1
- [ ] Specific, testable outcome 2
- [ ] Error handling: when X happens, show Y

### Design Reference
- Figma: [link]
- Similar to: [reference]
- Location in app: [describe where this appears]

### Dependencies
- Requires: #issue-number (feature name)
- Blocked by: [external dependency]

### Out of Scope
- Feature X (future sprint)
- Integration Y (not included)

### Priority
| Sprint | Priority | Complexity |
|--------|----------|------------|
| 1 or 2 | High/Med/Low | Simple/Med/Complex |

### Additional Context
Any other relevant information, business rules, or constraints.
```

---

## Section-by-Section Guide

### 1. Title Format

**Format:** `[Category] Feature Name`

| Category | Use For |
|----------|---------|
| `[Auth]` | Login, registration, passwords, sessions |
| `[CRM]` | Contacts, groups, import/export |
| `[Inbox]` | Messages, conversations, real-time updates |
| `[Admin]` | User management, roles, permissions |
| `[Dashboard]` | Analytics, counters, reports |
| `[Infra]` | Infrastructure, CI/CD, deployment |
| `[Integration]` | WhatsApp, SMS, Email, external APIs |

**Examples:**
- `[Auth] User Registration with Email Verification`
- `[CRM] Bulk Contact Import via CSV`
- `[Inbox] Real-time Message Updates`

---

### 2. Business Goal

Explain **WHY** this feature is needed. This helps developers understand context and make better decisions.

**Template:**
```
We need this feature because [business reason].
Currently, users cannot [limitation].
This will enable [benefit] which supports [business objective].
```

**Good Example:**
```
We need this feature because organizations want to onboard their teams.
Currently, users cannot add colleagues to their organization.
This will enable team collaboration which supports our multi-seat pricing model.
```

**Bad Example:**
```
We need user invitations.
```

---

### 3. User Stories

Describe the feature from the user's perspective. Cover ALL user types affected.

**Format:**
```
As a [user type],
I want to [specific action],
So that [measurable benefit].
```

**User Types in Turumba:**
| User Type | Description |
|-----------|-------------|
| Admin | Organization owner, full permissions |
| Agent | Team member, limited permissions |
| End Customer | Person receiving messages (WhatsApp/SMS) |
| System | Automated processes |

**Good Example:**
```
As an Admin,
I want to invite team members by entering their email,
So that I can build my support team without manual account creation.

As an Invited User,
I want to receive a clear invitation email with a registration link,
So that I can easily join my organization's account.

As an Admin,
I want to see pending invitations,
So that I can resend or cancel invitations that haven't been accepted.
```

---

### 4. Acceptance Criteria

The most critical section. List specific, testable outcomes that define "done."

**Rules:**
- Use checkboxes `- [ ]`
- Be specific and measurable
- Include error cases
- Include edge cases
- Think about what could go wrong

**Good Acceptance Criteria:**
```markdown
- [ ] "Invite Member" button visible on Team page (Admin only, not visible to Agents)
- [ ] Clicking button opens modal with: email field, role dropdown (Admin/Agent)
- [ ] Email field validates proper email format before submission
- [ ] Cannot invite an email that's already registered (error: "This email is already in use")
- [ ] Cannot invite the same email twice (show "Invitation pending" status)
- [ ] Successful invite sends email within 30 seconds
- [ ] Invitation email contains: organization name, inviter name, registration link
- [ ] Registration link expires after 7 days (show "Link expired" page if clicked after)
- [ ] Invited user completes registration → automatically added to organization with selected role
- [ ] Admin can view list of pending invitations with "Resend" and "Cancel" actions
- [ ] Cancelled invitation link shows "Invitation cancelled" page if clicked
```

**Bad Acceptance Criteria:**
```markdown
- [ ] User can invite people
- [ ] Email is sent
- [ ] Handle errors
```

---

### 5. Design Reference

Point to visual designs or describe the expected UI.

**If Figma exists:**
```
Figma: https://figma.com/file/xxxxx
Screen: "Team Management - Invite Modal"
```

**If no Figma:**
```
Location: Settings → Team Management page
Elements needed:
- "Invite Member" button (top right, primary blue style)
- Modal with form (similar to existing "Create Contact" modal)
- Table showing pending invitations below team member list

Mobile: Modal should be full-screen on mobile devices
```

**Reference similar features:**
```
Similar to:
- Slack's workspace invite flow
- Our existing "Create Contact" modal for form styling
```

---

### 6. Dependencies

List what must be completed before this feature can be built.

**Internal Dependencies:**
```markdown
Requires these features first:
- [ ] #25 - Authentication Logic (users must be able to register)
- [ ] #27 - Tenant Data Isolation (users must belong to organizations)
```

**External Dependencies:**
```markdown
Requires external setup:
- [ ] AWS SES configured for sending emails
- [ ] Email templates designed
```

**Decisions Needed:**
```markdown
Requires decisions:
- [ ] How long should invitation links be valid? (7 days recommended)
- [ ] Can Admins invite other Admins, or only Agents?
```

---

### 7. Out of Scope

Explicitly state what is NOT included. This prevents scope creep.

```markdown
This feature does NOT include:
- Bulk invite via CSV upload (separate issue: #XX)
- Custom invitation email templates (future enhancement)
- SSO/SAML-based invitations (Phase 2)
- Invitation approval workflow (not needed for MVP)
```

---

### 8. Priority & Timeline

| Field | Options | Description |
|-------|---------|-------------|
| Sprint | Sprint 1, Sprint 2, Backlog | When should this be done? |
| Priority | High, Medium, Low | How urgent? |
| Complexity | Simple, Medium, Complex | How big is this? |

**Complexity Guide:**
| Complexity | Description | Typical Duration |
|------------|-------------|------------------|
| Simple | Single screen, no integrations, straightforward logic | 1-2 days |
| Medium | Multiple screens, some business logic, API integration | 3-5 days |
| Complex | Multiple systems, complex logic, new infrastructure | 1-2 weeks |

---

## Examples

### Example 1: Well-Written Issue

```markdown
## [Admin] User Invitation System

### Business Goal
Organizations need to onboard team members. Currently, there's no way for an
Admin to add users to their organization. This blocks multi-user adoption and
our team-based pricing model.

### User Stories
As an Organization Admin,
I want to invite team members by email,
So that I can build my support team within Turumba.

As an Invited User,
I want to receive a clear invitation email,
So that I can easily join my organization's Turumba account.

As an Admin,
I want to see and manage pending invitations,
So that I can resend or cancel invitations as needed.

### Acceptance Criteria
- [ ] "Invite Member" button on Team page (visible to Admin only)
- [ ] Modal with email input and role selector (Admin/Agent)
- [ ] Email validation: must be valid email format
- [ ] Error if email already registered: "This email is already in use"
- [ ] Error if invitation pending: "Invitation already sent to this email"
- [ ] Success: invitation email sent within 30 seconds
- [ ] Email contains: org name, inviter name, registration link
- [ ] Link expires after 7 days
- [ ] Expired link shows: "This invitation has expired"
- [ ] Completed registration auto-assigns user to organization
- [ ] Pending invitations table with Resend/Cancel actions
- [ ] Agent users cannot see Invite button

### Design Reference
- Figma: https://figma.com/file/xxxxx (Screen: "Team Invite")
- Modal style: same as "Create Contact" modal
- Location: Settings → Team → top right button

### Dependencies
- [ ] #25 - Authentication Logic
- [ ] #27 - Tenant Data Isolation
- [ ] AWS SES email service configured

### Out of Scope
- Bulk invite via CSV
- Custom email templates
- Invitation approval workflow

### Priority
| Sprint | Priority | Complexity |
|--------|----------|------------|
| 1 | High | Medium |

### Additional Context
- Invited users should be pre-assigned to the organization even before
  they register (to show in "Pending" state)
- Consider rate limiting: max 50 invitations per day per organization
```

### Example 2: Poorly Written Issue (Don't Do This)

```markdown
## User Invitations

Add ability to invite users.

### Acceptance Criteria
- Users can be invited
- Email is sent
- It works on mobile
```

**Problems:**
- No category in title
- No business context
- No user stories
- Vague acceptance criteria
- No design reference
- No dependencies listed
- No scope boundaries

---

## Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| "Make it work" | Not testable | "User clicks X, sees Y" |
| "Handle errors" | Which errors? | "If password wrong, show 'Invalid credentials'" |
| "Fast performance" | Not measurable | "Load 10,000 contacts in under 2 seconds" |
| "Good UX" | Subjective | Link to Figma or describe specific interactions |
| "Like Slack" | Too vague | "Like Slack's invite modal, specifically: [screenshot]" |
| Missing edge cases | Bugs in production | List what happens when things go wrong |
| No out-of-scope | Scope creep | Explicitly list what's NOT included |

---

## Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. PM creates feature request using this template              │
│                              ↓                                  │
│  2. PM assigns to Technical Lead (@bengeos) for review          │
│                              ↓                                  │
│  3. Technical Lead reviews, asks clarifying questions if needed │
│                              ↓                                  │
│  4. Technical Lead breaks down into developer tasks             │
│     - Creates sub-issues in appropriate repositories            │
│     - Links sub-issues to parent feature request                │
│                              ↓                                  │
│  5. Technical Lead assigns sub-issues to developers             │
│                              ↓                                  │
│  6. Development & Review cycle                                  │
│                              ↓                                  │
│  7. Feature marked complete when all sub-issues done            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

### Issue Title Format
`[Category] Feature Name`

### Required Sections Checklist
- [ ] Business Goal (why?)
- [ ] User Stories (who and what?)
- [ ] Acceptance Criteria (how do we know it's done?)
- [ ] Design Reference (what does it look like?)
- [ ] Dependencies (what's needed first?)
- [ ] Out of Scope (what's NOT included?)
- [ ] Priority (when?)

### Labels to Use
| Label | Use For |
|-------|---------|
| `feature` | New functionality |
| `enhancement` | Improvement to existing |
| `priority:high` | Must be this sprint |
| `priority:medium` | Should be this sprint |
| `priority:low` | Can wait |
| `needs-design` | Needs Figma work |
| `needs-clarification` | Has questions |
| `blocked` | Waiting on dependency |

### Repository Guide
| Repository | Use For |
|------------|---------|
| `turumba_account_api` | Backend: users, auth, contacts, accounts |
| `turumba_messaging_api` | Backend: messages, channels, templates |
| `turumba_web_core` | Frontend: all web applications |
| `turumba_gateway` | API Gateway: routing, CORS |

---

## Questions?

Contact **@bengeos** (Technical Lead) for:
- Clarification on technical requirements
- Help determining dependencies
- Breaking down complex features

---

*Last updated: January 2025*
