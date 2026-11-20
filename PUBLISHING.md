# Publishing to npm

The package is public on GitHub and uses the unscoped npm name `opencode-kimi-meter`. Publishing requires access to an npm account authorized to own that name.

## One-time authentication

Log in interactively and verify the account:

```bash
npm login
npm whoami
```

Do not commit npm tokens, put them in `cli.json`, or paste them into chat. If the npm account requires two-factor authentication, complete it during login and publication.

## Release checklist

1. Start from a clean `main` branch synced with GitHub.
2. Review `git status`, the release diff, and the dependency audit. The current OpenCode/OpenTUI dependency tree has upstream moderate advisories; document their status rather than applying a breaking force-fix.
3. Confirm no credentials or private account details entered the source, tests, docs, or demo image.
4. Run all gates and inspect the package:

   ```bash
   npm ci
   npm test
   npm run typecheck
   npm pack --dry-run
   ```

   The tarball should contain only `src/`, the demo under `docs/`, `README.md`, `LICENSE`, and package metadata. Tests and machine-local configuration are intentionally excluded.

5. Set the release version. For example:

   ```bash
   npm version patch
   ```

   Use `minor` for backward-compatible features and `major` for breaking changes. `npm version` updates `package.json` and `package-lock.json`, then creates a commit and tag.

6. Publish:

   ```bash
   npm publish --access public
   ```

   `prepublishOnly` runs tests and type checking again. Publication will stop if either fails.

7. Push the version commit and tag:

   ```bash
   git push --follow-tags
   ```

8. Verify the registry and a clean installation:

   ```bash
   npm view opencode-kimi-meter version dist.tarball
   ```

   Add `opencode-kimi-meter` to a clean copy of OpenCode's `cli.json`, reload OpenCode, and verify the sidebar plus `/kimi` dashboard. Create a GitHub release for the tag with user-facing changes and any dependency-audit notes.

## Automation

The repository's CI workflow runs tests and type checking on pushes and pull requests. Automated npm publication is intentionally not enabled yet; add it only after deciding between npm trusted publishing/OIDC and a repository secret, and configure that authentication outside Git.
