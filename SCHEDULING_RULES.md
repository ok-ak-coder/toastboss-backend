# ToastBoss Scheduler: Role Assignment Rules

This document explains how ToastBoss creates an agenda. Its goal is to produce a fair first draft for the club to review; an admin can still edit any unlocked assignment manually.

## What the scheduler considers

For every role slot, ToastBoss considers only members who meet all applicable rules below.

### Availability

- **Always available** members can be assigned.
- **Never available** members are not considered for that meeting.
- **Tentative** members are considered for minor roles only: Opening Toast, Educational Moment, Grammarian, and Timer. They are not automatically assigned a major role.
- A date-specific availability setting takes precedence over a member's default availability.

### Role eligibility

Each member can be marked eligible for particular roles. A member is considered only for roles they are eligible to perform. A blank eligibility list means the member is eligible for all roles.

### Role-family cooldown

ToastBoss normally keeps a member from repeating the same role family until **two intervening meetings** have passed. The families are Toastmaster, Speaker, Barroom Topics, General Evaluator, Speech Evaluator, Improv Master, Educational Moment, Grammarian, Opening Toast, and Timer.

For example, if a member is Toastmaster on July 23, the scheduler normally will not choose them as Toastmaster again on July 30 or August 6. They become eligible again on August 13. Speaker 1 and Speaker 2 count as the same Speaker family; the two Speech Evaluator slots and the two Improv Master slots work the same way.

If nobody remains for a role after the cooldown is applied, ToastBoss may relax that cooldown so the role can still be filled. It does not relax availability or role eligibility.

### One role before anyone gets a second

For each role slot, ToastBoss first looks for a member who currently has **zero roles in that meeting** and can legally fill that slot. It gives that group priority over members who already have a role.

A second role is used only when no zero-role member can take that particular slot. That can happen because the unassigned members are unavailable, tentative for a major role, ineligible, in cooldown, or incompatible with the first role already assigned to the person receiving the second role.

No member can receive more than **two roles** in one meeting.

### Roles that are intentionally not paired

The scheduler will not give one person these pairs in the same meeting:

- Toastmaster with Barroom Topics, either Speaker slot, either Improv Master slot, General Evaluator, either Speech Evaluator slot, or Timer.
- Barroom Topics with either Speaker slot, General Evaluator, or Timer.
- Either Improv Master slot with the other Improv Master slot or the General Evaluator.
- A Speaker with the other Speaker slot, General Evaluator, or that speaker's matching Speech Evaluator slot.
- General Evaluator with either Speech Evaluator slot.

Other compatible role combinations can be assigned only after the one-role-per-member preference has been exhausted.

### First-time priority for key roles

For Toastmaster, Speaker, and Barroom Topics, members who have never held that role family have priority within the currently fair candidate group. This helps the club cycle through opportunities before repeating the same people.

### Agenda priority and optional roles

Roles marked **High** are filled before Standard roles, which are filled before Flexible roles. For equal priorities, agenda order is used. An optional role may remain unassigned if nobody eligible is available; a required role will show as unassigned in the same situation.

### Round-robin evaluations

If a Speech Evaluator slot is configured as **Round Robin**, ToastBoss places the text “Round Robin” instead of assigning an individual evaluator. It does not count as a member's role.

## How the final person is selected

After all rules and priorities above are applied, ToastBoss makes a random selection among the remaining equally qualified candidates. That means regenerating an **unlocked** agenda can produce a different fair result. Locking an agenda saves its assignments and prevents normal schedule generation from changing them.

## History used for fairness

ToastBoss looks back up to 52 weeks using recorded attendance, saved past agendas, and the club's imported schedule history. It uses the most recent earlier assignment for the same member and role family. A draft for the meeting currently being scheduled is not treated as past service.

## Locked agendas

Locking an agenda stores its assignments. Future scheduler improvements do not alter locked agendas automatically. To change one, an admin must deliberately unlock it and edit or regenerate it.

## Why a member may still have no role

An unassigned member is not necessarily being skipped. Common reasons are that they are marked Never or Tentative for that date, are not eligible for the remaining roles, are inside a cooldown, or the only remaining roles conflict with a role they already have. The role drop-downs show the same last-held information so an admin can review and override a draft when appropriate.
