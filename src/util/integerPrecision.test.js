const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const request = require('supertest');
const ivm = require('isolated-vm');
const Ajv = require('ajv/dist/2019');
const Ajv4 = require('ajv-draft-04');

const originalParse = JSON.parse;
const originalStringify = JSON.stringify;
const originalFlag = process.env.PRESERVE_INTEGER_PRECISION;

beforeEach(() => {
  process.env.PRESERVE_INTEGER_PRECISION = 'true';
  jest.resetModules();
});

afterEach(() => {
  JSON.parse = originalParse;
  JSON.stringify = originalStringify;
  if (originalFlag === undefined) delete process.env.PRESERVE_INTEGER_PRECISION;
  else process.env.PRESERVE_INTEGER_PRECISION = originalFlag;
});

const integers = [
  ['9007199254740991', 'number', '9007199254740991'],
  ['9007199254740993', 'bigint', '9007199254740993'],
  ['9223372036854775807', 'bigint', '9223372036854775807'],
  ['-9223372036854775808', 'bigint', '-9223372036854775808'],
  ['9007199254740993.0', 'bigint', '9007199254740993'],
  ['9.007199254740993e15', 'bigint', '9007199254740993'],
  ['1.25', 'number', '1.25'],
];

test.each(integers)('round-trips %s as %s', (input, type, output) => {
  const precision = require('./integerPrecision');
  const value = precision.parse(input);
  expect(typeof value).toBe(type);
  expect(precision.stringify(value)).toBe(output);
});

test('retains the existing parser and serializer when disabled', () => {
  process.env.PRESERVE_INTEGER_PRECISION = 'false';
  const precision = require('./integerPrecision');
  precision.install();
  expect(JSON.parse).toBe(originalParse);
  expect(JSON.stringify).toBe(originalStringify);
  expect(precision.sandboxBootstrap).toBe('');
});

test('preserves strings, decimals, revivers, replacers and nested integers', () => {
  const precision = require('./integerPrecision');
  const value = precision.parse(
    '{"id":9007199254740993,"items":[9223372036854775807],"text":"9007199254740993","fraction":1.25}',
  );
  expect(precision.stringify(value)).toBe(
    '{"id":9007199254740993,"items":[9223372036854775807],"text":"9007199254740993","fraction":1.25}',
  );
  expect(precision.parse('9007199254740993', (key, item) => item + BigInt(1))).toBe(
    BigInt('9007199254740994'),
  );
  expect(precision.stringify(value, ['id'])).toBe('{"id":9007199254740993}');
  expect(() => precision.parse('{')).toThrow();
});

test('Koa request and response preserve the numeric wire representation', async () => {
  const precision = require('./integerPrecision');
  precision.install();
  const app = new Koa();
  app.use(bodyParser());
  app.use(async (ctx) => {
    ctx.body = ctx.request.body;
  });
  const result = await request(app.callback())
    .post('/')
    .set('Content-Type', 'application/json')
    .send('{"id":9223372036854775807,"nested":[9007199254740993]}');
  expect(result.status).toBe(200);
  expect(result.text).toBe('{"id":9223372036854775807,"nested":[9007199254740993]}');
});

test('isolated-vm transfers BigInt and preserves sandbox JSON copies', async () => {
  const precision = require('./integerPrecision');
  const isolate = new ivm.Isolate({ memoryLimit: 32 });
  try {
    const context = await isolate.createContext();
    await context.eval(precision.sandboxBootstrap);
    const input = new ivm.ExternalCopy({ id: BigInt('9223372036854775807') }).copyInto();
    const output = await context.evalClosure(
      'return JSON.stringify(JSON.parse(JSON.stringify($0)));',
      [input],
      { result: { copy: true } },
    );
    expect(output).toBe('{"id":9223372036854775807}');
    await expect(context.eval('9007199254740993n + 1')).rejects.toThrow();
  } finally {
    isolate.dispose();
  }
});

test.each([Ajv, Ajv4])(
  'validates exact integers, bounds, enums and decimals with %p',
  (AjvClass) => {
    const { configureAjv, prepareSchema } = require('./integerValidation');
    const ajv = configureAjv(new AjvClass({ allErrors: true, strict: false }));
    const schema = {
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          minimum: BigInt('9007199254740993'),
          maximum: BigInt('9223372036854775807'),
        },
        literal: { enum: [BigInt('9007199254740993')] },
        fraction: { type: 'number', multipleOf: 0.25 },
      },
      required: ['id', 'literal', 'fraction'],
    };
    const validate = ajv.compile(prepareSchema(schema));
    expect(
      validate({
        id: BigInt('9223372036854775807'),
        literal: BigInt('9007199254740993'),
        fraction: 1.25,
      }),
    ).toBe(true);
    expect(
      validate({
        id: BigInt('9007199254740992'),
        literal: BigInt('9007199254740993'),
        fraction: 1.25,
      }),
    ).toBe(false);
    expect(
      validate({
        id: BigInt('9223372036854775807'),
        literal: BigInt('9007199254740994'),
        fraction: 1.25,
      }),
    ).toBe(false);
    expect(
      validate({ id: '9223372036854775807', literal: BigInt('9007199254740993'), fraction: 1.25 }),
    ).toBe(false);
  },
);
