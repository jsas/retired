# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in RE: tired, please report it responsibly by emailing jsas@github.com instead of using the public issue tracker.

Please include:
- A clear description of the vulnerability
- Steps to reproduce (if applicable)
- Potential impact
- Any suggested fixes you may have

We will acknowledge receipt and work with you to address the issue promptly.

## Security Considerations

### Client-Side Only

RE: tired runs **entirely in your browser**. Your retirement plans and financial data:
- Are **never** sent to a server
- Are stored **only** in your browser's `localStorage`
- Remain under your complete control

### No Authentication or Accounts

There are no user accounts, logins, or cloud storage. You fully own your data.

### Data Export & Backup

You can:
- Export plans as JSON files
- Generate shareable links (stored as URL hash, not on a server)
- Print summaries locally

### Third-Party Dependencies

We use:
- **React 19** — UI framework
- **Vite** — build tool
- **TypeScript** — type safety
- **Tailwind CSS** — styling
- **Lucide** — icons

We keep dependencies up-to-date and monitor for security advisories via GitHub's Dependabot.

### Known Limitations

- Browser localStorage has typical browser security constraints (origin-based isolation)
- Shared computers may allow other users to access stored plans
- The app requires JavaScript enabled
- Some calculations involve approximations — see the Disclaimer in the README

## Deployment

The live app is deployed to GitHub Pages at https://jsas.github.io/retired/ via GitHub Actions CI/CD. Builds are gated by automated tests.

## Security Updates

We will:
- Patch critical vulnerabilities promptly
- Update dependencies regularly
- Communicate fixes in release notes and commits
- Tag security-related releases

Thank you for helping keep RE: tired secure!