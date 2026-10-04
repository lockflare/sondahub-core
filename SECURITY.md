# Security Policy

## Reporting a vulnerability

Please report security issues privately by email to **engineering@lockflare.com**, rather than through a public GitHub issue.

Include:

- What you found
- The affected version (`GET /v1` reports the running version)
- Steps to reproduce the issue

We aim to reply within a few business days. Please allow a reasonable amount of time for investigation and remediation before publicly disclosing a vulnerability.

There is currently no bug bounty program.

## Supported versions

Only the latest release of `sondahub-core` receives security fixes.

## What sondahub-core is for

`sondahub-core` is a mock API server intended for development and testing.

It is designed to run on your own computer or inside a controlled test environment and listens on `127.0.0.1` by default.

It is not designed to be exposed directly to the public internet or to store real or sensitive data.

## Not vulnerabilities

The following behaviors are intentional and are not considered security vulnerabilities:

- The playground credentials included in the source code and README (`sonda` / `probe` and `sonda-probe-key`). These credentials are deliberately public and protect nothing; they exist solely so API clients can exercise authentication flows.
- CORS allowing requests from any origin.
- Writes being accepted from any client that can reach the server. All stored data is generated test data.
- Issues that arise only after deliberately exposing the server to an untrusted network, such as running with `HOST=0.0.0.0` on a publicly reachable machine.

Reports concerning only these intended behaviors may be closed without further action.
