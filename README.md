# sqs-consumer-2

### Deployment

1. Make changes in `src/` directory.
2. `yarn build` compiles `src/` source to `lib/` directory (it also runs tests).
3. Create a pull request.


### Publishing to Github Packages

Make sure you have configured Github token for the repository:

```sh
npm config set '//npm.pkg.github.com/:_authToken' "${GITHUB_TOKEN}"
```

To publish new versions, run the following:

```sh
yarn release [major|minor|patch]
```

### TODO

- Add release-it to the CI workflow
