const { enabled, parse } = require('./integerPrecision');

const numericKeys = [
  'type',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'const',
  'enum',
];

function encodeLiteral(value) {
  return { type: typeof value, value: String(value) };
}

function equalInteger(data, literal) {
  return (
    (['bigint', 'number'].includes(literal.type) && data === parse(literal.value)) ||
    (literal.type === 'number' &&
      Number.isSafeInteger(Number(literal.value)) &&
      data === BigInt(literal.value))
  );
}

function validateInteger(rules, data) {
  if (typeof data !== 'bigint') return false;
  if (data < BigInt('-9223372036854775808') || data > BigInt('9223372036854775807')) {
    return false;
  }
  if (rules.type && !rules.type.some((type) => ['integer', 'number'].includes(type))) {
    return false;
  }
  if (rules.const && !equalInteger(data, rules.const)) return false;
  if (rules.enum && !rules.enum.some((literal) => equalInteger(data, literal))) return false;
  if (rules.minimum !== undefined && data < parse(rules.minimum)) return false;
  if (rules.maximum !== undefined && data > parse(rules.maximum)) return false;
  if (typeof rules.exclusiveMinimum === 'string' && data <= parse(rules.exclusiveMinimum)) {
    return false;
  }
  if (typeof rules.exclusiveMaximum === 'string' && data >= parse(rules.exclusiveMaximum)) {
    return false;
  }
  // Draft-04 represents exclusive bounds as booleans.
  if (rules.exclusiveMinimum === true && data <= parse(rules.minimum)) return false;
  if (rules.exclusiveMaximum === true && data >= parse(rules.maximum)) return false;
  if (rules.multipleOf !== undefined) {
    const match = /^(\d+)(?:\.(\d+))?(?:[Ee]([+-]?\d+))?$/.exec(rules.multipleOf);
    if (!match) return false;
    const coefficient = BigInt(`${match[1]}${match[2] || ''}`);
    const scale = Number(match[3] || 0) - (match[2] || '').length;
    if (coefficient === BigInt(0) || Math.abs(scale) > 1024) return false;
    const numerator = scale >= 0 ? coefficient * BigInt(10) ** BigInt(scale) : coefficient;
    const denominator = scale < 0 ? BigInt(10) ** BigInt(-scale) : BigInt(1);
    if ((data * denominator) % numerator !== BigInt(0)) return false;
  }
  return true;
}

function configureAjv(ajv) {
  if (!enabled) return ajv;
  ajv.addKeyword({
    keyword: 's555BigInt',
    schemaType: 'boolean',
    validate: (expected, data) => (typeof data === 'bigint') === expected,
    errors: false,
  });
  ajv.addKeyword({
    keyword: 's555Int64',
    schemaType: 'object',
    validate: validateInteger,
    errors: false,
  });
  return ajv;
}

function prepareSchema(schema) {
  if (!enabled || typeof schema !== 'object' || schema === null) return schema;
  const result = { ...schema };
  for (const key of [
    'properties',
    'patternProperties',
    'definitions',
    '$defs',
    'dependentSchemas',
  ]) {
    if (result[key]) {
      result[key] = Object.fromEntries(
        Object.entries(result[key]).map(([name, child]) => [name, prepareSchema(child)]),
      );
    }
  }
  for (const key of [
    'items',
    'additionalItems',
    'additionalProperties',
    'contains',
    'not',
    'if',
    'then',
    'else',
    'propertyNames',
  ]) {
    if (result[key] !== undefined) {
      result[key] = Array.isArray(result[key])
        ? result[key].map(prepareSchema)
        : prepareSchema(result[key]);
    }
  }
  for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    if (result[key]) result[key] = result[key].map(prepareSchema);
  }
  const types = schema.type === undefined ? undefined : [schema.type].flat();
  const numeric =
    types?.some((type) => ['number', 'integer'].includes(type)) ||
    ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].some(
      (key) => schema[key] !== undefined,
    ) ||
    ['number', 'bigint'].includes(typeof schema.const) ||
    schema.enum?.some((value) => ['number', 'bigint'].includes(typeof value));
  if (!numeric) return result;

  const rules = {};
  const normal = { s555BigInt: false };
  for (const key of numericKeys.filter((name) => schema[name] !== undefined)) {
    delete result[key];
    if (key === 'type') {
      rules.type = types;
      normal.type = schema.type;
    } else if (key === 'enum') {
      rules.enum = schema.enum.map(encodeLiteral);
      normal.enum = schema.enum.map((value) => (typeof value === 'bigint' ? Number(value) : value));
    } else if (key === 'const') {
      rules.const = encodeLiteral(schema.const);
      normal.const = typeof schema.const === 'bigint' ? Number(schema.const) : schema.const;
    } else {
      rules[key] = typeof schema[key] === 'boolean' ? schema[key] : String(schema[key]);
      normal[key] = typeof schema[key] === 'bigint' ? Number(schema[key]) : schema[key];
    }
  }
  result.allOf = [
    ...(result.allOf || []),
    { anyOf: [normal, { s555BigInt: true, s555Int64: rules }] },
  ];
  return result;
}

module.exports = { configureAjv, prepareSchema, validateInteger };
