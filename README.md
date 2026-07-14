# sqs-consumer-2

### Development

1. Make changes in `src/` directory.
2. Run `npm run build` to compile `src/` source to `lib/` directory (it also runs tests).
3. Document your changes in `CHANGELOG.md` and bump the version in `package.json`.
4. Create a pull request and get it approved and merged.
5. After merge, run `npm run release [major|minor|patch]` from `main` to publish the new version.



### Publishing to Github Packages

Make sure you have configured Github token for the repository:

```sh
npm config set '//npm.pkg.github.com/:_authToken' "${GITHUB_TOKEN}"
```


