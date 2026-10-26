# Functional reference: Kaseya Quote Manager

DubLow's proposal and quoting app is modeled on the **full functionality of Kaseya Quote Manager** (KQM, formerly
Datto Commerce). KQM is the reference product: when we need to decide how a feature should behave, what fields it
needs or how an edge case is handled, the default answer is "do what KQM does", unless a DubLow decision below or in
the rebuild plan says otherwise.

**Reference source:** the KQM help site, https://help.quotemanager.kaseya.com/
(start at the [product overview](https://help.quotemanager.kaseya.com/help/Content/1-start/datto-commerce-overview.htm)).

Our own summary of that site (about 150 pages studied) and the DubLow build plan live in
[`quote-manager-rebuild.md`](quote-manager-rebuild.md).

## How to use the reference

1. **Check our notes first.** Sections 1 to 9 of `quote-manager-rebuild.md` summarize KQM by area. If the answer is
   there, use it.
2. **Then the help site.** For anything the notes don't cover or only cover briefly (exact field lists, statuses,
   validation rules, error behavior, wording of settings), look it up at https://help.quotemanager.kaseya.com/ and
   follow it.
3. **Record what you learn.** When the help site answers a question that changed how we built something, add a short
   note to the matching section of `quote-manager-rebuild.md`, with the help page URL.
4. **Note where we differ.** If we deliberately do something differently from KQM, record it under
   "Deliberate differences" below, with the reason.

## Where to look, by topic

| Question about | Our notes (`quote-manager-rebuild.md`) | Help site area |
| --- | --- | --- |
| Overall workflow, process models | §1 Product overview | Getting started / overview |
| Users, roles, settings, notifications | §2 Admin settings, users and onboarding | Settings, Team |
| Suppliers, feeds, products, bundles, inventory | §3 Catalog | Suppliers, Products |
| Margin rules, list price guard, price groups, bids, tax, shipping, coupons, payments | §4 Pricing | Pricing, Tax, Shipping, Payments |
| Quote editor, templates, blocks, approvals, reminders, e-signature | §5 Quoting | Quotes |
| Sales orders, Purchasing Optimizer, purchase orders, receipting | §6 Sales and purchasing | Sales, Purchases |
| Storefront and customer portal | §7 Online Store | Online Store |
| ConnectWise PSA, Autotask, accounting, distributors, SSO, API | §8 Integrations | Apps / Integrations |
| Reports, security | §9 Reporting and security | Reports |

## Precedence when sources disagree

1. DubLow decisions recorded in this repo (`CLAUDE.md` security rules, `quote-manager-rebuild.md` §10 and §11,
   and "Deliberate differences" below).
2. The KQM help site.
3. Our summary notes. If they conflict with the help site, the help site wins; fix the notes.

The security rules in `CLAUDE.md` (bearer auth, confirm-before-write, no deletes, audit log) always apply, even where
KQM behaves differently.

## Scope

The **target** is KQM's full feature set. The rebuild plan (§10) sets the **order** in which we build it: an internal
proposal tool on ConnectWise items and live D&H data comes first. Features the plan lists as "dropped or deferred"
(Online Store, Stripe checkout, tax provider, Purchasing Optimizer, receipting, more distributors) are still part of
the target. They are later phases, not out of scope forever, and KQM remains the reference for them when we get there.

## Deliberate differences from KQM

| Area | KQM | DubLow | Why |
| --- | --- | --- | --- |
| Product data | GfK Etilize content plus about 65 supplier feeds | ConnectWise catalog plus live D&H lookups | Licensed content isn't reused; D&H is DubLow's distributor |
| Branding and copy | Kaseya | DubLow's own | No Kaseya branding or copy is reused |
| ConnectWise writes | Direct sync | Through this bridge: dry run, then a single-use confirm token; no deletes | `CLAUDE.md` security rules |
| Accepted proposal in ConnectWise | Opportunity (and optionally a ticket) | Proposed: opportunity when sent, won plus sales order when accepted | See `quote-manager-rebuild.md` §11; pending Todd's confirmation |

KQM content on the help site is Kaseya's. Use it as a functional reference only: don't copy its text, screenshots or
branding into the app.
