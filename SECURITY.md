# Security Policy

## Reporting vulnerabilities

Report security vulnerabilities through [GitHub private vulnerability reporting](https://github.com/itsreverence/tweet-share/security/advisories/new). Do not open a public issue for a vulnerability before it has been assessed.

Never paste live Discord webhook URLs, private/protected post contents, account cookies, tokens, or X/Twitter session details into an issue, pull request, or screenshot. Revoke and replace any webhook you believe has been exposed.

For ordinary usage problems that do not expose sensitive details, follow [SUPPORT.md](SUPPORT.md).

## Usage boundaries

This repository provides an unofficial browser userscript for manually sharing posts the user can already view. Requests or changes that turn it into a bulk scraper, access-control bypass, spam tool, account automation tool, or private-content redistribution system are outside scope.

Users are responsible for following X/Twitter, Discord, and server/community rules when installing or using the script.

## In scope

- Userscript code vulnerabilities
- Build or release workflow vulnerabilities
- Unsafe webhook handling or storage behavior
- Documentation that could cause unsafe installation or credential handling

## Out of scope

- X/Twitter or Discord platform vulnerabilities
- Lost, leaked, or abused webhook URLs outside this userscript
- Requests to bypass X/Twitter access controls or scrape content the user cannot view

## Supported versions

Security fixes target the latest published release. Users should update through their userscript manager or reinstall from [GitHub Releases](https://github.com/itsreverence/tweet-share/releases/latest).
