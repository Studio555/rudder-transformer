# Studio555 integer precision

Based on upstream `v1.157.0`, commit `d147847af99af926238c9d90d8030bf7ddea98c3`, matching the transformer running before this change. The Node 22.22.3 runtime supports the native JSON source/raw-token APIs used by the patch; no JSON dependency is added.

`PRESERVE_INTEGER_PRECISION=true` opts into exact integer parsing and numeric BigInt serialization throughout the process and user-transformation sandboxes. Values outside JavaScript's safe integer range become BigInt. Smaller numbers and fractions retain Number behavior. Tracking-plan validation supports BigInt types, enum/const rules, bounds and multiples without converting event values to Number. The setting defaults to false and requires a restart.

Large integers remain JSON numbers over HTTP. Transport also preserves out-of-range values so the server can report an int64 validation error for the affected event. A user transformation that explicitly converts BigInt to Number can still lose precision; review and test active transformations before promotion.

Run precision and compatibility tests:

```sh
npm ci --ignore-scripts --no-audit
npm run prepare
npm test -- --runTestsByPath src/util/integerPrecision.test.js \
  test/__tests__/user_transformation.test.js test/__tests__/eventValidation.test.js \
  --runInBand --no-coverage
```

The `studio555-ci.yml` workflow tests PRs targeting `studio555/v1.157.0`. It builds and smoke-tests an amd64 image and publishes that same image on a maintenance-branch push, using its full source SHA as the tag. It never deploys. Before publication, the operator provisions the publisher in `s555-iac` and sets repository variables from `rudderTransformerImagePublisherWorkloadIdentityProvider` and `rudderTransformerImagePublisherServiceAccount`.

Promote this image together with the patched server only after the server fork's `.studio555/precision-canary.py` passes against `ingress_nonprod`.
