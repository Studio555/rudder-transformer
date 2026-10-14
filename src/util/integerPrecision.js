const enabled = process.env.PRESERVE_INTEGER_PRECISION === 'true';
const nativeParse = JSON.parse;
const nativeStringify = JSON.stringify;

function integerText(source) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[Ee]([+-]?\d+))?$/.exec(source);
  if (!match) return undefined;
  let digits = `${match[2]}${match[3] || ''}`.replace(/^0+/, '');
  if (!digits) return '0';
  const scale = Number(match[4] || 0) - (match[3] || '').length;
  if (scale < 0) {
    if (-scale >= digits.length || /[1-9]/.test(digits.slice(scale))) return undefined;
    digits = digits.slice(0, scale);
  } else {
    if (scale > 1024 || digits.length + scale > 1024) {
      throw new RangeError(`integer ${source} is too large to parse safely`);
    }
    digits += '0'.repeat(scale);
  }
  return `${match[1]}${digits}`;
}

function parse(text, reviver) {
  return nativeParse(text, function revive(key, value, context) {
    let exact = value;
    if (typeof value === 'number' && context?.source) {
      const digits = integerText(context.source);
      if (digits !== undefined) {
        const integer = BigInt(digits);
        if (
          integer < BigInt(Number.MIN_SAFE_INTEGER) ||
          integer > BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          exact = integer;
        }
      }
    }
    return typeof reviver === 'function' ? reviver.call(this, key, exact, context) : exact;
  });
}

function stringify(value, replacer, space) {
  const allowed = Array.isArray(replacer) ? new Set(replacer.map((key) => String(key))) : undefined;
  return nativeStringify(
    value,
    function replace(key, input) {
      if (allowed && key !== '' && !Array.isArray(this) && !allowed.has(key)) return undefined;
      const output = typeof replacer === 'function' ? replacer.call(this, key, input) : input;
      if (typeof output !== 'bigint') return output;
      return JSON.rawJSON(output.toString());
    },
    space,
  );
}

function install() {
  if (!enabled) return;
  if (typeof JSON.rawJSON !== 'function') {
    throw new Error('integer precision requires JSON.rawJSON support');
  }
  const probe = nativeParse('9007199254740993', (key, value, context) => context?.source);
  if (probe !== '9007199254740993') {
    throw new Error('integer precision requires JSON.parse source support');
  }
  // JSON is the shared boundary used by Koa, fetch responses, caches and transformation helpers.
  JSON.parse = parse;
  JSON.stringify = stringify;
}

// isolated-vm has its own realm. Install the same implementation there before user code runs.
const sandboxBootstrap = enabled
  ? `(() => {
      const nativeParse = JSON.parse;
      const nativeStringify = JSON.stringify;
      const integerText = ${integerText.toString()};
      JSON.parse = ${parse.toString()};
      JSON.stringify = ${stringify.toString()};
    })();`
  : '';

module.exports = { enabled, install, parse, stringify, sandboxBootstrap };
