# Website Company Enricher — Emails, Socials & Tech Stack

**Turn a list of company websites into ready-to-use leads.** For every website you get **one row per company** with:

- 📧 **Emails** — company-domain addresses first (also decodes Cloudflare-protected and `name [at] domain [dot] com` addresses)
- 📞 **Phone numbers** — from click-to-call links and structured data
- 🔗 **Social profiles** — LinkedIn, X/Twitter, Facebook, Instagram, YouTube, TikTok, Pinterest, GitHub, Discord, Telegram, WhatsApp, Threads
- 🏢 **Company details** — name, description, logo, address, language
- 🧰 **Tech stack** — CMS, e-commerce platform, analytics, CRM, marketing tools, hosting… (7,600+ technologies)

**$0.01 per website** — 1,000 companies cost $10. Websites that can't be loaded are free.

## Why this actor

- 🧾 **One row per company, not per page.** Contacts from the homepage and the most relevant contact / about / imprint / team pages are merged and deduplicated — ready for your CRM or spreadsheet.
- 🎯 **CRM-ready columns.** Best `email`, `phone`, `linkedin`, `facebook`, … as flat columns for CSV/Excel import, plus full lists (`emails`, `phones`, `socials`) when you want everything.
- 🧰 **Tech stack included.** Segment leads by what they run (Shopify vs. WooCommerce, HubSpot vs. Salesforce, WordPress, Webflow…) in the same run.
- 💸 **Flat, predictable price.** One price per website no matter how many pages are checked. No subscription, no per-page charges, no charge for failures.
- ⚡ **Fast and light.** Plain HTTP (no headless browser) — typically 1–4 seconds per website, 10–20 websites in parallel.
- 🧹 **Clean data.** Share buttons, tracking keys, placeholder addresses (`you@example.com`), image file names (`logo@2x.png`) and other junk are filtered out.

## Use cases

- **Lead generation & enrichment** — you have a list of domains (from a directory, a trade-show list, a CRM export, Google Maps results…); get emails, phones and socials for each.
- **Sales prospecting by technology** — *"Shopify stores with an Instagram and a contact email"*, *"agencies running WordPress + HubSpot"*.
- **CRM hygiene** — fill missing company names, logos, LinkedIn pages and descriptions.
- **Market research** — which tools does a segment use, and how do they present themselves?
- **AI agents** — a single "tell me about this company's website" tool (via the Apify API or MCP server).

## Input

```json
{
  "urls": ["plausible.io", "buffer.com", "https://www.allbirds.com"],
  "maxPagesPerSite": 4,
  "includeTechnologies": true
}
```

| Field | Description |
|---|---|
| `urls` | Company domains or URLs. |
| `maxPagesPerSite` | Homepage + the most relevant contact/about/imprint/team pages (1–10, default 4). Same price either way. |
| `includeTechnologies` | Detect the tech stack (default on). |
| `minConfidence` | Minimum confidence for technologies (0–100, default 50). |
| `maxConcurrency` | Websites processed in parallel (1–20, default 10). |
| `timeoutSecs` | Per-page timeout (default 20). |

## Output (one item per website)

```json
{
  "url": "https://plausible.io/",
  "domain": "plausible.io",
  "companyName": "Plausible Analytics",
  "description": "Plausible is a lightweight and open-source Google Analytics alternative...",
  "email": "hello@plausible.io",
  "phone": null,
  "linkedin": "https://www.linkedin.com/company/plausible-analytics",
  "twitter": "https://x.com/PlausibleHQ",
  "emails": ["hello@plausible.io"],
  "phones": [],
  "socials": {
    "twitter": ["https://x.com/PlausibleHQ"],
    "linkedin": ["https://www.linkedin.com/company/plausible-analytics"]
  },
  "logo": "https://plausible.io/assets/images/icon/apple-touch-icon.png",
  "address": null,
  "language": "en",
  "technologies": ["Plausible", "Bunny", "Alpine.js", "Ruby"],
  "byCategory": { "Analytics": ["Plausible"], "CDN": ["Bunny"], "JavaScript frameworks": ["Alpine.js"] },
  "pagesVisited": ["https://plausible.io/", "https://plausible.io/contact", "https://plausible.io/imprint", "https://plausible.io/about"],
  "error": null
}
```

Export as CSV, Excel or JSON, schedule recurring runs, or send results to Google Sheets, HubSpot, Make, Zapier or n8n.

## Use it as an API

```bash
curl -X POST "https://api.apify.com/v2/acts/kfirs~website-company-enricher/run-sync-get-dataset-items?token=YOUR_APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["plausible.io", "buffer.com"]}'
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_APIFY_TOKEN")
run = client.actor("kfirs/website-company-enricher").call(run_input={"urls": ["plausible.io"]})
for company in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(company["domain"], company["email"], company["linkedin"])
```

## Pricing

| Event | Price |
|---|---|
| Website enriched (homepage loaded) | $0.01 |
| Website unreachable / blocked / timed out | free |
| Actor start | $0.00005 |

## What it can and can't find

It reads what a company publishes on its own website: links, visible text, and structured data (schema.org). It does **not** guess email addresses, look up people in third-party databases, or log in anywhere. Websites that block automated visitors (e.g. strict bot protection) return an error and are not charged. Content that only appears after JavaScript runs may be missed.

Use the data responsibly and in line with the privacy and anti-spam laws that apply to you (e.g. GDPR, CAN-SPAM).

## Source & license

Source code: [github.com/kfirs97/website-company-enricher](https://github.com/kfirs97/website-company-enricher) (GPL-3.0). Technology fingerprints © [webappanalyzer](https://github.com/enthec/webappanalyzer) contributors (GPL-3.0).
