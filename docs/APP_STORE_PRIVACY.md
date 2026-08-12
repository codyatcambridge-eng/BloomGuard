# BloomGuard App Store Privacy Inventory

## Status

This document is a submission checklist, not a published privacy policy or
legal opinion. `PrivacyInfo.xcprivacy` is intentionally conservative and must
be reconciled with the final production binary, Xcode privacy report, Supabase
retention configuration, public privacy policy, and App Store Connect answers
before submission.

The privacy work must not change the `freezeMVP0` protection behavior.

## Current off-device data flows

| Flow | Current fields | Recipient | Proposed App Store category | Purpose |
| --- | --- | --- | --- | --- |
| Protection settings | Device ID and protection preferences | Supabase | Device ID; Product Interaction | App functionality |
| Block/moderation logs | Device ID, domain/URL context, classification, action | Supabase | Browsing History; Device ID; Product Interaction | App functionality; analytics |
| Prototype labels | Media URL, page URL, prediction, thresholds, label, optional comment | Supabase edge function | Browsing History; Other User Content; Product Interaction; Device ID where associated | App functionality; analytics/model improvement |
| Accountability partners | Device IDs and partner email | Supabase | Device ID; Email Address | App functionality |

Raw image bytes are documented as local-only in the normal label queue, but
this must be verified against every upload and edge-function path. Media and
page URLs are still off-device data and must be disclosed.

## Current manifest assumptions

The initial manifest declares:

* no cross-app tracking
* browsing history
* device identifier
* email address
* other user content
* product interaction

The listed data is conservatively marked as linked because records can be
associated through a persistent device identifier. Do not change this to
unlinked unless the backend architecture and retention policy prove that the
association is removed before collection.

`NSPrivacyAccessedAPITypes` is currently empty. Before submission, generate an
Xcode privacy report from the Release archive and add only Apple-approved
required-reason entries actually reported by the app or dependencies. Do not
guess required-reason codes.

## Required submission work

1. Generate and inspect the Release archive privacy report.
2. Confirm privacy manifests and signatures supplied by Capacitor, Capgo, and
   other packaged SDKs.
3. Confirm every production Supabase table/function, transmitted field,
   retention period, access role, and deletion path.
4. Decide whether model-improvement labels remain in the MVP. If retained,
   require explicit opt-in before enqueue/upload and provide a way to withdraw
   or delete pending data.
5. Replace periodic empty-queue polling with bounded, lifecycle-aware work or
   prove through device energy testing that it is inactive when unnecessary.
6. Publish a privacy policy and support/contact page.
7. Provide an in-app privacy entry explaining collection, controls, and
   deletion/contact procedure.
8. Complete App Store Connect privacy answers from this inventory and the
   generated Xcode report.
9. Set an appropriate age rating for unrestricted or embedded web content.
10. Re-audit whenever a new SDK, account feature, telemetry path, or data field
    is introduced.

## Release evidence to retain

* archived `PrivacyInfo.xcprivacy`
* Xcode privacy report
* App Store Connect privacy-answer export/screenshots
* public privacy-policy URL and revision date
* Supabase retention/deletion documentation
* consent-flow screenshots
* physical-device network and Energy Log results
