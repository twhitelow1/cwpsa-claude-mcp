# Kaseya Quote Manager: Feature Notes and Rebuild Plan

Oct 25, 2026 · Todd (DubLow Digital)

Sections 1 to 10 are Todd's research notes and plan, kept as written. Section 11 maps the plan onto this
repository: what the ConnectWise bridge already provides, what was added for it, and what is still open.

How to use KQM as the functional reference, and where DubLow differs: [`kaseya-quote-manager-reference.md`](kaseya-quote-manager-reference.md).

## 1. Product overview

Kaseya Quote Manager (KQM, formerly Datto Commerce) is a cloud quote-to-procure platform for MSPs and IT resellers: it turns supplier product feeds into a branded storefront, quotes from templates in about 30 seconds, and automates sales orders and supplier purchase orders. Notes below come from the [KQM help site](https://help.quotemanager.kaseya.com/help/Content/1-start/datto-commerce-overview.htm) (151 pages studied).

**Two interfaces, one login.** The Online Store is a branded storefront used by both customers ("organizations") and staff; staff with admin rights additionally see supplier pricing, availability, margin controls and per-organization portals. The Admin Center (left nav: Home, Quotes, Sales, Purchases, Organizations, Suppliers, Products, Reports, Online Store, Apps, Settings) manages everything behind it, with an onboarding dashboard on Home that tracks setup progress.

**Core transaction workflow.**

1. Supplier feeds create and price products automatically (GfK Etilize product data included).
2. Staff or customers build a quote (from a template in Admin Center, or from a cart in the Online Store), or buy directly without quoting.
3. Accepted quotes convert to a sales order (or tax invoice, a display setting), optionally gated by approval.
4. The Purchasing Optimizer raises supplier purchase orders using best availability and price, or creates purchasing suggestions for staff.
5. Staff receipt goods against purchase orders; receipting creates bills and invoices in the accounting system.
6. PSA sync keeps quotes, orders and POs linked to opportunities and tickets (Autotask, ConnectWise PSA).

**Three process models:** standard (PSA + accounting), standalone high-volume reseller (accounting/ERP only), and custom (ERP/CRM via the KQM API).

## 2. Admin settings, users and onboarding

Admin Center navigation is a left rail (Home, Quotes, Sales, Purchases, Organizations, Suppliers, Products, Reports, Online Store, Apps, Settings) plus a top bar (Show me resources, in-product Notifications, Help, My Account with API access, KaseyaOne). Home carries an onboarding dashboard with green and red status per setup feature, and a self-paced guided walkthrough launches on first admin login.

**Roles and visibility.** Four roles with an Entire company or Owner only visibility switch (Owner only limits a user to their own quotes, sales and notifications).

| Role | Orgs and suppliers | Quotes and sales | Purchases | Products | Reports | Settings |
| --- | --- | --- | --- | --- | --- | --- |
| Admin | Full | View, edit, approve | Full | Full | Full | Full |
| Standard | Full | View, edit, approve | Full | Full | Full | Optional |
| Sales | Full | View, edit | View only | Full | Optional | Optional |
| Purchasing | Full | View only | Full | Full | Optional | Optional |

Only Admins reach quote templates. Users are invited by email (link valid one week), may be forced to Datto Portal SSO, can be deactivated with reassignment of their organizations and open quotes, cannot have passwords reset by others, and support MFA with an authenticator app. Log in with KaseyaOne provides unified login.

**Settings pages.** Company details (names, tax number, addresses, date and time, number format, currency, document number prefixes and starting numbers for quotes, sales orders and POs, quote auto-save); Brands; Domains (one custom site domain via CNAME and TXT verification, multiple email domains via DKIM and Return-Path with SPF, DKIM and DMARC health shown green, yellow or red); Email templates (Standard, New Organization and MSA samples, rich editor, variable tags such as {Quote Title} and {Trading Name}, mobile and desktop preview, global default, linkable to a quote template); Notifications (email recipients for any sales order, sales orders needing approval, and quote viewed, approval requested, approved, rejected, declined, won, each to an address or the quote owner); Payments; Pricing; Quote Approval Rules; Quote Reminders; Sales; Shipping; Tax; Team; KaseyaOne; Cooper Copilot (AI features with explicit opt-in, currently product description summaries); Warehouses (name, email for shipment instructions, address).

**Organizations (customers).** Fields: name, tax number, price group, owner, can pay on account, contacts (many, with a send-invoices flag; invitation emails expire after one week), billing and delivery addresses, Collect tax toggle. List shows orders, total spent, last order and average order value. Organizations cannot be deleted, only renamed inactive, and merges go through support. PSA sync is the main import path.

**In-product notifications.** Bell with unread count and Inbox and Archived tabs. Warnings: quote margin decreased, quote now has insufficient stock, quote has a deleted product; error: PO failed to send via supplier API. Alerts clear themselves once the underlying issue is fixed or the quote is won, lost or deleted.

**Files.** A simple file store that returns a stable URL usable in quotes, product descriptions, pages and emails.

## 3. Catalog: suppliers, feeds, products, inventory

The catalog is feed-driven: supplier feeds create, price, stock and retire SKUs automatically, and staff only hand-edit exceptions.

**Suppliers.** Fields: name, email (POs are sent here, semicolon-separated), addresses, supplier number (auto), Online toggle with Online ETA (offline suppliers are skipped by procurement, and the store shows ETA + 1 day), Priority (a percentage premium from -99.99 to 99.99 the buyer will pay to prefer a supplier; negative de-prioritizes), can drop ship, can drop ship to P.O. box, and a shipping charge by order-value range used only to cost supply, not to charge customers. Suppliers cannot be deleted; they are taken offline, de-prioritized or have their feed removed. Your own business is added as a supplier to carry inventory.

**Product feeds.** One importer per supplier. Source: FTP, HTTP(S), SFTP, email, or distribution; scheduled imports plus Import now. Status badges per supplier: green imported, yellow feed unavailable, red critical failure. History shows duration and SKUs created, updated, deleted and reactivated, plus errors; the latest feed can be downloaded as CSV. Supplier categories are mapped to store categories where GfK Etilize data is missing. A legacy standard CSV importer and bid import (under 200 SKUs) cover suppliers without a feed.

**Four product types.**

| Type | Meaning | Procurement behavior |
| --- | --- | --- |
| Physical | Bought from supplier, delivered | PO raised, availability and freight considered |
| Non physical | External service, licence, warranty | PO raised, always in stock, no freight logic |
| Service | Internal service | No PO, manual fulfilment |
| Bundle | Kit of existing SKUs | Each component bought from best supplier; synced to PSA as one line |

**Product fields.** Title, auto part number, list price (RRP), optional override price with start and end dates, tax code or tax-exempt, suppliers, cost (services), bundle components, HTML description and specification, MPN, brand, category, weight (kg), images (PNG/JPG, 250 px minimum height). Toggles: Online store (offline items stay visible to staff in grey and can still be quoted or shared by URL), Recommended (floats to top of search), Serialized, Recurring (monthly, quarterly, yearly). Extras: lock supplier cost or quantity until a date so feeds cannot overwrite it, copy product, soft delete and reactivate, hide price (override of $0 shows Contact for quote), fixed bundle price. Brands are required on products; managed brands are read-only and custom brands accept a logo of at least 150 px and aliases.

**Inventory and serials.** Warehouses hold stock; stock is received by raising a PO against your own business. In-stock units are always allocated first, shipping requests go to the warehouse, serials are allocated FIFO, and mark-ups use average cost. Serial numbers are entered at receipt; stock levels, audit history, and an Inventory summary report are available. It is explicitly not an accounting system (no write-offs or valuation).

## 4. Pricing, tax, shipping, coupons, bids, payments

Sell price is computed, never typed: cost from the cheapest in-stock online supplier, plus a category margin rule, capped by a list price guard, minus an organization group discount, then overridden by bids, quoted prices or fixed prices.

**Price resolution order.**

1. Base cost: cheapest supplier that has stock and is online (inventory on hand wins even if dearer; average cost applies to stock).
2. Margin rule: Margin % or fixed Profit Amount, set at four category tiers (All Products, top categories, sub-categories, sub-sub-categories), most specific wins. Margin means selling price = cost / (1 - margin), so 25% on $100 gives $133.33.
3. List price guard: hard cap at RRP but never below cost, ignore RRP, or allow a limited percentage of margin to be sacrificed to meet RRP (example: cost $100, margin 25%, RRP $120, guard 60% gives $120).
4. Organization price groups: two group discounts expressed as a percentage off the margin, assigned per organization.
5. Bid price: applied if present; an active quoted price that is higher overrides the bid.
6. Fixed (override) price on a product, optionally scheduled, supersedes rules but not bid or quote. A $0 override hides the price.

Other rules: the highest previously quoted price is shown to an organization; cost-price uplift is advised via supplier feeds; prices never go below cost unless manually fixed; a setting shows prices including tax.

**Bids and CTO.** Two modes. Imported supplier quotes (spreadsheet, MPN-keyed) apply only to one quote, are all-or-nothing, and auto-create missing SKUs. Manual bids (title, bid number, expiry defaulting to one month, supplier, PO note, optional organization, per-line min quantity, cost, sell price) apply to one organization or everyone and show in the store. The Purchasing Optimizer buys at bid cost only if no better price or special exists, ignoring supplier stock.

**Tax.** Regions are added explicitly. US: state nexus list, shipping taxability (Auto, Fully taxed, Not taxed), destination-based tax via TaxJar using category, origin and shipping address; Canada: GST/HST automatic, PST/QST per registered province; other countries: named multi-rate GST/VAT with a default. Separate purchase-tax rates apply to POs. Tax is estimated while building and calculated exactly at checkout. Per-product tax code or exempt, and per-organization exemption.

**Shipping.** Price-based bands (min, max, cost) and weight-based bands (min, max, base cost, optional cost per kg or lb). Recommended defaults: under 10 kg $10 below $200 and free above; heavy $15 to $25; bulky calculated at checkout; P.O. box +$10.

**Coupons.** Code (typed or generated), name, dates, percent or amount off product price only, minimum order value, max uses overall and per organization, free shipping, cumulative flag, limits by category, product or organization. Store checkout only; quotes use manual price edits.

**Payments.** Stripe credit card with optional surcharge percentage, pay on account (per-organization flag, defaults, bank details, terms, requires approval), and manual prepaid methods with instructions (also require approval). Fraud: Stripe rules, warning plus manual approval for orders from outside the business region.

**Sales settings.** Accounts required or optional at checkout; show or hide MPN; quote viewing controls (code plus email, storefront login, PDF attachment, view and accept while in draft); auto-approval threshold for online orders; send order confirmation; PO creation mode (draft, auto-send, or none); display document as invoice or sales order; phone-based anti-fraud authentication; Terms, Privacy and Refund policy text shown at checkout and on quotes.

## 5. Quoting

Quoting is the product's centerpiece: a block-based, web-rendered proposal with live pricing, customer-side choices, e-signature, analytics and an audit trail.

**Quote statuses.** Draft, Pending Approval, Approved - Ready to Send, Sent, Viewed (customer views only), Declined, Won. Won quotes convert once to a sales order; changes after winning mean copying the quote and re-accepting.

**Quote header fields.** Title (defaults to Quote number), expiry (default 14 days), display language (Danish, Dutch, English, French, German, Italian, Swedish), send-reminders toggle, organization (sets price group), recipient contact, 6-digit secure access code with its own expiry, delivery address (required for freight and tax), owner, PSA opportunity (or auto-created), Autotask proposal project, linked sales order, private note. Auto-save every 15 seconds; version history with restore; copy with kept or refreshed pricing; delete; save as template; manual mark as sent or declined.

**Template builder.** Admin-only gallery with a default template. Block types: Text (rich HTML with images, video embeds, tables), Splash (background image, tint color, opacity, blend mode, height), Products, Accept. Block options: padding, move, delete, background color, print height (page or auto). Variable fields such as {Organization Name} auto-populate. Quotes can start from a template, a blank canvas, an existing quote, or a cart in the Online Store (SAVE AS QUOTE).

**Product blocks.** Search by title, MPN, internal or supplier part number, with category and availability filters and a per-supplier stock tooltip. Editable columns: Qty, Price, Cost (Auto or a chosen supplier, which locks cost into the later PO), List price, Tax, Cost % off list, % off list, Margin %, Profit, Subtotal, where editing any of price, margin, % off list or profit recalculates the others. Customer sees only Qty, Price, Tax and Subtotal. Per-block toggles: show products, show prices, show AI product summary (needs 300+ character descriptions), multi-choice (customer picks exactly one of consecutive blocks). Per-line toggles: optional (checkbox, default on or off), editable quantity, recurring (monthly, quarterly, yearly, number of cycles), per-line discount in percent or dollars, custom one-off product, drag to reorder. Labor blocks pull tasks and role rates from a linked Autotask proposal project. Excel paste import maps columns to build bid pricing, auto-creates missing SKUs, and can calculate price by auto markup, margin or list discount.

**Accept block.** Splits charges into one-off, monthly and yearly totals, adds shipping (calculated or manually overridden) and tax (estimated while editing, exact on view). Acceptance requires agreeing to the Terms of Service plus optional PO number, ticket and payment info, and a digital signature; staff can accept on a customer's behalf.

**Approvals.** Rule types: Total Quote Value, Item Discount Value, Item Discount Percent, Item Margin, Total Quote Margin, each with less-than or greater-than and a value, plus a list of users who always need approval. Flow: Request Approval, Pending Approval, then Reject and Return (reason required, added to the private note), Approve and Send, or Approve and Notify. Edits to an approved quote require re-approval; Recall Quote reopens a pending one.

**Reminders.** Two global rules, expiring in 1 to 6 days and not viewed in 1 to 7 days, each with an editable email template and tag insertion, and a per-quote Send Reminders toggle.

**Security and evidence.** Secure Quote Access (code plus email, regenerate with or without resend, code expiry), optional storefront login, optional PDF attachment. Signed, tamper-proof PDF with an audit trail (document ID, signature, view and sign timestamps, IP and email). Quote analytics show view count, last view, average duration and per-view detail, excluding staff views.

## 6. Sales orders, Purchasing Optimizer, purchase orders

Accepting a quote or checking out creates a sales order (SO); approving it triggers automated procurement, which raises one or more supplier purchase orders (POs) that are later receipted.

**Sales orders.** Statuses Draft, Approved, Cancelled; fulfillment Unfulfilled, Part fulfilled, Fulfilled. Tiles: All, Draft, Unfulfilled, Current Month; filter by owner. An order needs manual approval when it exceeds the auto-approval threshold, uses a prepaid method, has negative margin, comes from an invalid or out-of-region IP, repeats too quickly, or ships to a P.O. box; orders with obsolete or deleted SKUs cannot be approved. Approval dialog lists the reasons and allows notes, owner change and ticket link. Edits: price and quantity until fulfilled (never below fulfilled quantity), per-line tax, quantity 0 cancels a line, cancel whole order with optional card refund, no adding new SKUs (create a new SO). Manual fulfillment is for service SKUs and orders whose POs were cancelled, with time units, cost and tracking info. Staff must manually amend the matching PO and notify the supplier.

**Purchasing Optimizer, in priority order.**

1. Warehouse stock first (shipment request emailed to the warehouse with FIFO serials).
2. Supplier status (offline suppliers are last resort).
3. Supplier availability (stock on hand).
4. Supplier priority percentage and price including delivery cost.
5. Bid pricing for the organization.

Behaviors: similar MPNs from different suppliers are linked by a matching algorithm; if one supplier can fill everything it picks the cheapest and splits across suppliers only when the saving exceeds $10 net of delivery; non-physical SKUs ignore stock; service SKUs raise no PO; quote-line cost overrides pin the supplier. PO creation mode is a setting: draft for manual approval, auto-send, or none.

**Purchase orders.** Contents: company details and tax number, PO number, delivery details (warehouse, drop-ship to customer address, or manual), bid number, notes (for license keys), supplier reference limited to 50 characters, due date. Statuses Draft, Approved, Received, Cancelled, with send status Sent, Not sent or Failed (email bounce or supplier API failure). Tiles: All, Draft, Approved, Overdue, Current month. Manual PO creation (for stock or manual fulfilment), approve and send, resend, change supplier, due date, cost or tax, cancel, and link to an SO by drop-ship toggle. Receipting: supplier invoice number and date, per-line received quantity and cost, serials, landed costs such as freight, shipment email with tracking (AfterShip) toggle. A short receipt automatically spawns a follow-on PO with suffix /1, /2. Receipting creates the bill in the accounting system and, once all lines are receipted, the invoice. After receipt, neither PO nor SO can change. POs sync to PSA or accounting in roughly 10 minutes.

**Edge cases handled.** Mixed-availability POs (receive what arrived, switch supplier for the rest, or reduce quantity and raise a manual PO), bundle purchases where one component goes to stock, and electronic ordering to supplier APIs with failure notifications. Proof of delivery and tracking appear under My Orders in the store.

## 7. Online Store and organization portal

The store is a white-labeled B2B storefront on the customer's own subdomain, shared by customers and staff, where pricing and visibility depend on who is logged in.

**Customer experience.** Browse as guest, but log in for accurate pricing, quote acceptance and ordering. Sign-up by invitation (or open sign-up when accounts are optional, a retail mode). Product menu bar by category, filters, In Stock versus All Stock, sort (Best Match, Lowest Price, Highest Price, Newest, Oldest), search by title, brand, MPN, supplier part number or internal part number; Recommended tag floats curated products first. Product page: availability, description, photos, specs, related items, share, email, print. Cart with automatic bulk pricing, coupon code, company PO number, delivery step (default, alternate, warehouse, one-off address), payment step, Terms of Service agreement, Place Order. Self-quote: Save as Quote, Email Quote to the provider, then Accept. My Account: account centre, details, My Orders with tracking and proof of delivery, reprint of order or invoice with serials, My Quotes with expiry dates.

**Staff view.** Staff land as Guest and switch into any organization portal to see that customer's pricing; they still see offline and out-of-range products, supplier cost and stock (a View Stock window lists location, supplier part, quantity, cost, last feed update, offline highlight), can edit cart pricing and shipping, tie an order to a PSA ticket, and ship to a warehouse or their own office. The cart survives switching organizations and reprices.

**Storefront customization.** Theme colors (primary, secondary, success, danger, navigation and footer background and text), heading and body fonts, header logo, footer logo, favicon, home page slideshow (1920 x 500 recommended, each slide optionally linked), category tiles, rich HTML home content, SEO title and meta description. Product range controls: show only Recommended items, limit to selected brands (bundles containing an unselected brand are hidden entirely). Landing pages: HTML plus an ordered list of products added by MPN, shareable privately by URL, with pricing that still reflects the viewer. Footer links to preset pages (home, contact, brands), landing pages or URLs, plus automatic legal policy links. Integrations: Google Analytics and Tag Manager IDs, Facebook Pixel through Tag Manager, Mailchimp pop-up, chat widgets, arbitrary scripts, and a no-index switch. Contact page is generated from company details.

**Security around the store.** Optional required accounts, Stripe fraud rules, region check on IP with forced manual approval for foreign IPs, phone-based anti-fraud authentication, and advice to ship new customers only to business addresses.

## 8. Integrations

The Apps page offers tiles for Amazon Business, Autotask, ConnectWise PSA, Xero, QuickBooks Online and Microsoft Teams: install, authorize, then enable individual sync entities; deleting an app removes all mappings. A read-only REST API supports custom ERP or BI work.

**ConnectWise PSA (most relevant to DubLow).** Connect with site, company ID and a public and private key from a dedicated, non-licensed API member whose security role has All on Companies, Procurement, Sales, Service Desk and System items, and whose member record has a location and business unit. Sync entities, each with a toggle:

| Entity | Direction and behavior |
| --- | --- |
| Organizations | Two-way. Choose type (Organization or Prospect), status (Active) and contact type (Approver, End User) in each direction |
| Opportunities | Quote creates or updates an opportunity and quote with default stage, status, location, department, type, owner and probability; separate won and lost stage and status; sales orders without a quote become won opportunities |
| Tickets | Orders create or update a ticket with a note, or with note and products when invoicing from tickets; default board, location, department; serial numbers added as ticket notes |
| Products | SKUs created in ConnectWise on first use, matched by MPN; default type, class, recurrence; category mapping |
| Purchase orders | Receipted POs sync as completed POs linked to Purchasing Demand; suppliers must be mapped to vendors; failure email address |

Timing: KQM to ConnectWise is near instant; ConnectWise to KQM takes 5 to 15 minutes. Errors surface as notifications with Retry. Recommended: invoice from the opportunity, set documents to display as Sales Order, create the ConnectWise sales order before receipting the PO, and never invoice before receipt.

**Autotask.** Same pattern plus inventory sync every 10 minutes (inventory locations become suppliers, optional Autotask pricing), proposal projects and labor blocks in quotes, Won Opportunity Wizard handoff, an Insight panel showing quote status inside Autotask, and detailed mapping of KQM items to Autotask products, services, charges, shipping and surcharges.

**Accounting.** QuickBooks Online syncs organizations, POs, bills (receipted POs), and sales orders as invoices with mapped items, tax, creditors, discount and surcharge accounts, optional QuickBooks invoice numbering and a PO field placement. Xero supports bills only; MYOB is manual CSV import. Stripe handles cards; reconciliation tools are suggested.

**Suppliers.** About 65 feed integrations across the US, Canada, UK, Europe, Australia and New Zealand (D&H, Ingram Micro, TD SYNNEX, Tech Data, CDW, ScanSource, Arrow, Newegg, Amazon Business and others). Feed sources are FTP, SFTP, HTTP(S), or an inbound email mailbox per tenant, with sender and subject filters; formats are supplier-specific parsers plus a universal CSV mapper (delimiter, quote symbol, number format, weight unit, column mapping for MPN, supplier part number, brand, title, cost ex tax, list price, stock, weight, category). Rules: brand must exist, cost above zero, unique SKU, and Ingram US and Canada feeds support delta updates (A, C, D). Electronic ordering sends POs through supplier APIs (Ingram Micro with client ID and secret, validated weekly) and Amazon Business places orders through its Ordering API with hourly price and stock checks, partial fulfillment banners and tracking. Digital suppliers (CSP, Pax8-style) use priority 999 so subscription SKUs always route there.

**Identity and other.** Log in with KaseyaOne (SSO, forced login with exceptions, just-in-time user creation and deprovisioning), Datto Portal SSO, Microsoft Teams alerts, Google Analytics and Tag Manager, Mailchimp. API: base URL under api.kaseyaquotemanager.com/v1, API key, modifiedAfter filter, 100 results per page, limits of 60 calls per minute and 20,000 per day with HTTP 429.

## 9. Reporting, notifications and security

**Reports.** Seven CSV exports with a date range, selectable columns and a 500-row export cap (the inventory report uses a single as-of date): Quote summary and detail, Sales summary, detail, unfulfilled (back orders) and by coupon, Purchase summary and detail, and Inventory summary. Detail reports list one row per SKU and carry brand, category, recurrence, cost, discount, profit, tax and shipping. Cost on a sale is replaced by actual cost at fulfilment, so gross profit on open orders is an estimate. Most report data is also on the API. Quote analytics (views, duration, viewer) are per quote.

**Security model to copy.** MFA with authenticator app, TLS 1.2 or higher with automatic certificates for custom domains, AES-256 at rest, tenant data isolation, role-based least privilege, cards handled only by Stripe (no card data stored), admin access logging, geo-redundant encrypted backups kept 30 days, and tamper-proof signed quote PDFs with audit trail.

**Gaps and limits in the original** that a rebuild can improve on: no recurring billing engine (invoices are made in the PSA or accounting tool), no parent and child organizations, no origin-based tax, one custom domain per tenant, read-only API, organizations cannot be deleted or merged by users, orders cannot gain new SKUs after creation, no cart-abandonment reporting, and exports are capped at 500 rows.

## 10. Rebuild plan (scoped to DubLow: proposals from ConnectWise items plus live D&H hardware data)

Scope decision: the Online Store is out. The rebuild is an internal proposal tool for DubLow Digital that builds quotes and proposals from the items already in ConnectWise PSA and pulls live hardware pricing, stock and specs from D&H. Everything else in the original (about 65 supplier feeds, the Purchasing Optimizer, Stripe checkout, tax, SSO, multi-tenant admin) is deferred or dropped. Kaseya branding, copy and the licensed GfK Etilize content are not reused; D&H supplies the product data.

### What we keep from the original

The parts of Kaseya Quote Manager that matter for this use are: the block-based web quote (text, line items, optional items, terms, signature), quote templates, category margin rules with a list price guard, good/better/best style alternatives, secure share link with access code, signed PDF with audit trail, quote reminders, and quote to sales order hand-off into the PSA. The original's sales order sync to ConnectWise and its distributor feed concept are the two integrations that define the rebuild.

### What is dropped or deferred

Online Store and customer carts, Stripe checkout, tax provider, multi-supplier feed library and electronic ordering beyond D&H, Purchasing Optimizer, receipting and serial tracking, Autotask, accounting sync, KaseyaOne SSO, public API and AI summaries. Revisit after the core tool is in daily use.

### Architecture

A small TypeScript app (Next.js) on GitHub and Vercel, with Postgres for quotes, templates, margin rules and a cache of D&H and ConnectWise data. Single tenant (DubLow) to start, with sign-in through Microsoft 365 since the team already uses it. A background job runner (Vercel cron or Inngest) refreshes cached data and handles syncs. Resend sends quote and reminder emails. Quote PDFs are generated server side and stored with a hash for the audit trail.

Three adapters sit behind a clean interface so the rest of the app never talks to a vendor directly:

- ConnectWise adapter: reads the product catalog, companies, contacts and opportunities; creates or updates a quote or sales order and its line items; links to tickets and projects as needed. Uses the ConnectWise Manage REST API with a dedicated API member and keys stored as encrypted secrets.
- D&H adapter: live search by manufacturer part number, keyword or category; returns price, stock by warehouse, specs and images. Prices are fetched live (with a short cache, for example a few minutes) and re-checked when a quote is sent or accepted. The D&H search logic already built for the laptop advisor can be reused here.
- Pricing engine: a pure function that takes cost (from D&H or the ConnectWise catalog), category margin rules and the list price guard, and returns the sell price with an explanation of which rule applied.

### Core data model

Quotes (status, version, company and contact from ConnectWise, owner, expiry), quote blocks, quote line items (source: ConnectWise item or D&H item, cost, sell price, margin, quantity, optional flag, alternative group), templates, margin rules by category, share links with access code, signature and audit events, reminders, sync log (what was pushed to ConnectWise, when, result), and a cached catalog of ConnectWise items and D&H lookups.

### Phased roadmap

| Phase | Scope | Outcome |
| --- | --- | --- |
| 0. Spike | Confirm ConnectWise API access and the exact catalog, company and sales order endpoints; confirm D&H API credentials and fields for price, stock and specs | Risks retired before building |
| 1. Catalog and pricing | ConnectWise item browser and search, live D&H hardware search, margin rules, list price guard, price explanation | Accurate sell prices from both sources in one search box |
| 2. Proposal builder | Block-based quote and proposal editor, templates (including the Good/Better/Best laptop layout and managed services bundles), optional items, branded DubLow PDF | Build a full proposal in minutes |
| 3. Client delivery | Secure share link with access code, online accept and e-signature, signed PDF with audit trail, reminders, view tracking | Clients accept proposals online |
| 4. ConnectWise round trip | Push accepted quotes to ConnectWise as opportunity or sales order with line items; optional draft D&H purchase order from the order | Quote to order without retyping |
| 5. Polish | Reports on quote volume, win rate and margin; expiry and price-change alerts when D&H cost moves after a quote is sent | Visibility and fewer margin surprises |

Phases 0 to 2 deliver a usable internal tool; phases 3 and 4 close the loop with the client and the PSA.

### Risks and open decisions

- ConnectWise data quality: the tool is only as good as the catalog items in ConnectWise. Plan a short clean-up of item names, categories and cost fields.
- D&H live data limits: confirm rate limits and whether pricing is account-specific; cache briefly and re-verify at send and acceptance.
- Price drift: hardware cost changes between quote and order. Show an expiry date on every quote and alert when cost moves.
- Sync safety: ConnectWise writes must be idempotent with a visible error log, so a retry never creates duplicate orders.
- Existing tools: DubLow already has a Proposal Desk and a laptop quote flow. Decide whether this replaces them or becomes the engine behind them, so there is one source of truth for packages and pricing.
- Open question: should accepted proposals create a ConnectWise opportunity, a sales order, or both?

## 11. How this bridge fits the plan

This repository (the DubLow ConnectWise Bridge) is already most of the **ConnectWise adapter**. The proposal
app should call the bridge's REST API (`/api/v1/*`, read) and MCP write tools, or import its `src/lib` modules
directly if it lives in the same repo, rather than talking to ConnectWise itself. That keeps one set of
credentials, one audit log and one confirm-before-write flow.

### Already in place

| Plan need | Bridge piece |
| --- | --- |
| Catalog search (ConnectWise items) | `cw_search_catalog` / `GET /api/v1/catalog` |
| Companies and contacts for the quote header | `cw_search_companies`, `cw_get_company`, `cw_search_contacts` |
| Push accepted quote as opportunity with lines | `cw_create_opportunity` (lines become `/procurement/products` with `chargeToType: Opportunity`) |
| Push accepted quote as sales order with lines | `cw_create_sales_order`, `cw_add_sales_order_line` (`chargeToType: SalesOrder`) |
| Write safety | `WRITES_ENABLED` gate, dry run + single-use HMAC confirm token bound to the exact requests, no deletes |
| Sync log | Audit JSON line per call (tool, ids, mode, status) in Vercel logs |
| D&H adapter seam | `DistributorAdapter` interface in `src/lib/distributors/types.ts` (D&H is a stub), design in `docs/distributors.md` |

### Added with this document (Phase 1 start)

- **Pricing engine**, `src/lib/pricing.ts`: pure `priceItem()` implementing the resolution order from section 4
  (category margin % or profit amount with most-specific-wins, list price guard in cap / ignore / partial modes,
  price-group discount off the profit, never below cost, then fixed / bid / quoted overrides). Returns the sell
  price, profit, margin and a human-readable list of steps. Tests cover the worked examples from this document
  ($100 at 25% → $133.33; cost $100, 25%, list $120, guard 60% → $120).
- **`cw_price_catalog`** read tool and `GET /api/v1/catalog/pricing`: catalog search plus a proposed sell price for
  each item from its ConnectWise cost. It takes a single margin or profit rule as input. Per-category rule sets
  need storage, so they arrive with the app's Postgres tables. It changes nothing in ConnectWise.

### Phase 0 checklist (against this bridge)

1. `npm run smoke` against the deployment confirms auth, catalog, companies and contacts.
2. Run `cw_price_catalog` over a few real SKUs and check that the catalog `cost` field is populated. Items without
   a cost come back flagged, which feeds the data clean-up in the risks list.
3. With `WRITES_ENABLED=true` on a preview deployment, dry-run `cw_create_opportunity` and `cw_create_sales_order`
   for a test company and check the planned bodies against the required fields in `CLAUDE.md`.
4. Get D&H API credentials and confirm the price, stock-by-warehouse and spec fields, then replace the D&H stub
   with a real adapter (mocked tests first, per `docs/distributors.md`).

### Gaps to close before Phase 4

- **Idempotency.** The confirm token is single use, so the same preview can't run twice. A retry after a network
  failure in the middle of a multi-request plan could still leave a partial order. Before Phase 4, stamp the
  proposal id on the ConnectWise record (for example the sales order `poNumber` or an opportunity field) and look it
  up before creating, so a retry finds the existing record and doesn't create a duplicate.
- **Updating an existing opportunity** (stage to won, add lines later) has no tool yet. It would be a PATCH through
  `runWrite()`.
- **D&H items not in the ConnectWise catalog** need either a custom line (`CW_MISC_CATALOG_ITEM_ID`) or a catalog
  item created first. This is open question 3 in `docs/distributors.md`.

### Recommendation on the open question

Do both, at different moments. Create (or update) the **opportunity when the proposal is sent**, so the pipeline in
ConnectWise shows it. When the client **accepts**, mark the opportunity won and create the **sales order** with the
same lines. This matches KQM's ConnectWise behavior and its advice to invoice from the opportunity and create the
sales order before receipting.
