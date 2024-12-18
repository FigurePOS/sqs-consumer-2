# sqs-consumer-2

### Development

1. Make changes in `src/` directory.
2. Run `npm run build` to compile `src/` source to `lib/` directory (it also runs tests).
3. Run `npm run release [major|minor|patch]` to publish a new version.
4. Create a pull request.


### Publishing to Github Packages

Make sure you have configured Github token for the repository:

```sh
npm config set '//npm.pkg.github.com/:_authToken' "${GITHUB_TOKEN}"
```


### TODO

- Add release-it to the CI workflow
