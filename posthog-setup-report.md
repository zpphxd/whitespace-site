# PostHog post-wizard report

The wizard has completed a full analytics integration of the Whitespace marketing site. PostHog was added via the CDN snippet (no build tooling required — this is a plain static HTML site). Event tracking was wired into `index.html` and `features.html` using inline JavaScript event listeners. No existing code was modified; all PostHog additions are appended after the existing scripts. Environment variables are stored in `.env` for documentation purposes.

## Events instrumented

| Event name | Description | File |
|---|---|---|
| `download_clicked` | User clicked a 'Download for macOS' button in the hero or CTA sections | `index.html` |
| `download_clicked` | User clicked the download button on the features page (nav or CTA) | `features.html` |
| `nav_download_clicked` | User clicked the small 'Download' CTA in the fixed navigation bar | `index.html` |
| `github_clicked` | User clicked a GitHub link (View source / Build from source) | `index.html` |
| `board_tour_started` | User began scrolling into the interactive board journey section | `index.html` |
| `board_tour_completed` | User scrolled through the entire board journey and reached the finale CTA | `index.html` |
| `finale_download_clicked` | User clicked the download button in the board finale | `index.html` |
| `finale_source_clicked` | User clicked 'Build from source' in the board finale | `index.html` |
| `features_page_viewed` | User navigated to the features page | `features.html` |
| `features_cta_clicked` | User clicked a CTA button at the bottom of the features page | `features.html` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/489874/dashboard/1792660)
- [Total download clicks — 30 days](https://us.posthog.com/project/489874/insights/THSJkOkv)
- [Download clicks over time](https://us.posthog.com/project/489874/insights/eQ5aFqzR)
- [Board tour engagement funnel](https://us.posthog.com/project/489874/insights/dQaRgRtd)
- [Features page engagement](https://us.posthog.com/project/489874/insights/ggTHTkZz)
- [Features page to download funnel](https://us.posthog.com/project/489874/insights/pLydUQtx)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add the exact PostHog env var names you added to `.env.example` and any monorepo/bootstrap scripts so collaborators know what to set (`POSTHOG_PUBLIC_TOKEN`, `POSTHOG_HOST`).

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
