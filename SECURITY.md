# Security · 安全问题

## Report privately / 请私密报告

Please use GitHub's **[Report a vulnerability](https://github.com/tonyyunyang/80-fen-shengji/security/advisories/new)** flow for security issues. Include the affected commit, reproduction steps, impact and a minimal synthetic example. Do not put working keys, real cookies or private hands into public issues.

安全问题请使用上面的 GitHub 私密报告入口，提供受影响版本、复现步骤、影响与虚构示例。请勿在公开 Issue 中粘贴真实 key、cookie、私人牌谱或其他人的手牌。

Maintainers review reports periodically; there is no guaranteed response or fix timeline. The latest `main` is the supported development line. Older snapshots may need to be updated rather than receiving a separate backport.

## Scope

Relevant issues include cross-session access, CSRF, credential disclosure, unsafe provider destinations, hidden-hand leakage and stale actions changing a new game. Ordinary gameplay bugs belong in [issues](https://github.com/tonyyunyang/80-fen-shengji/issues/new/choose).

Local saves and CLI credentials are private operator data. A backend operator can read that server's memory and files; use your own server when entering a provider key if you do not trust another operator.

[Session isolation and deployment details](docs/security-and-deployment.md)
