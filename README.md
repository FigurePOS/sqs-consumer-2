# sqs-consumer-2

### Deployment

1. Make changes in `src/` directory
2. `yarn build` compiles `src/` source to `lib/` directory (it also runs tests)
3. Create a pull request

### Publishing to Github Packages

We use [release-it](https://github.com/release-it/release-it) to make it easier to publish new versions to Github Packages repository. It handles common tasks like bumping version based on semver, creating tags and releases etc.

Make sure you have configured Github token for the repository:

```sh
npm config set '//npm.pkg.github.com/:_authToken' "${GITHUB_TOKEN}"
```

To publish new versions, run the following:

```sh
yarn release [major|minor|patch]
```
