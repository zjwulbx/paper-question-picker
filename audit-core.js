(function attachAuditCore(root, factory) {
  "use strict";

  let nodeCrypto = null;
  if (typeof module === "object" && module.exports && typeof require === "function") {
    try {
      nodeCrypto = require("node:crypto");
    } catch (_error) {
      nodeCrypto = null;
    }
  }
  const api = factory(root, nodeCrypto);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AuditCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAuditCore(root, nodeCrypto) {
  "use strict";

  const PROTOCOL_ID = "paper-question-picker/v4";
  const NORMALIZATION_ID = "nfc-lines/v1";
  const RNG_ID = "sha256-ctr-u64be-u32be-reject/v1";
  const SCHEDULE_ID = "min-count-fisher-yates/v1";
  const RECEIPT_FORMAT = "paper-question-picker-commitment";
  const REPORT_FORMAT = "paper-question-picker-final-audit";
  const FORMAT_VERSION = 4;
  const MAX_ITEMS = 10000;
  const MAX_LABEL_BYTES = 4096;
  const MAX_INPUT_BYTES = 8 * 1024 * 1024;
  const UINT32_RANGE = 0x100000000;
  const TRIM_EDGES = /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g;

  const D_INPUT = asciiBytes("paper-question-picker/input/v4\0");
  const D_COMMIT = asciiBytes("paper-question-picker/commitment/v4\0");
  const D_RNG_KEY = asciiBytes("paper-question-picker/rng-key/v4\0");
  const D_RNG_BLOCK = asciiBytes("paper-question-picker/rng-block/v4\0");
  const D_PLAN = asciiBytes("paper-question-picker/plan/v4\0");

  // v4 stays frozen below so previously issued receipts and reports remain
  // independently verifiable. New draws use the v5 protocol, which adds one
  // globally unique presenter per paper to the deterministic plan.
  const V5_PROTOCOL_ID = "paper-question-picker/v5";
  const V5_NORMALIZATION_ID = "nfc-lines/v1";
  const V5_RNG_ID = "sha256-ctr-split-u64be-u32be-reject/v2";
  const V5_SCHEDULE_ID = "min-count-plus-uniform-presenter-matching/v2";
  const V5_FORMAT_VERSION = 5;
  const V5_D_INPUT = asciiBytes("paper-question-picker/input/v5\0");
  const V5_D_COMMIT = asciiBytes("paper-question-picker/commitment/v5\0");
  const V5_D_QUESTION_RNG_KEY = asciiBytes("paper-question-picker/rng-key/questions/v5\0");
  const V5_D_QUESTION_RNG_BLOCK = asciiBytes("paper-question-picker/rng-block/questions/v5\0");
  const V5_D_PRESENTER_RNG_KEY = asciiBytes("paper-question-picker/rng-key/presenters/v5\0");
  const V5_D_PRESENTER_RNG_BLOCK = asciiBytes("paper-question-picker/rng-block/presenters/v5\0");
  const V5_D_PLAN = asciiBytes("paper-question-picker/plan/v5\0");
  const V5_MAX_PRESENTER_ATTEMPTS = 4096;

  const SHA256_INITIAL = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const SHA256_CONSTANTS = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function exactKeys(value, keys, code, label) {
    if (!isObject(value)) fail(code, label + "格式不正确。");
    const actual = Object.keys(value).sort();
    const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some(function mismatch(key, index) {
      return key !== expected[index];
    })) fail(code, label + "包含缺失或不支持的字段。");
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function same(value, index) {
      return value === right[index];
    });
  }

  function asciiBytes(value) {
    const result = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code > 0x7f) throw new Error("ASCII constant contains a non-ASCII character");
      result[index] = code;
    }
    return result;
  }

  function assertNoLoneSurrogates(value, code, label) {
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          fail(code, label + "含有无效的 Unicode 代理项。");
        }
        index += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        fail(code, label + "含有无效的 Unicode 代理项。");
      }
    }
  }

  function utf8Bytes(value, code, label) {
    const text = String(value);
    assertNoLoneSurrogates(text, code || "INVALID_UNICODE", label || "文本");
    const output = [];
    for (let index = 0; index < text.length; index += 1) {
      let point = text.charCodeAt(index);
      if (point >= 0xd800 && point <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        point = 0x10000 + ((point - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
      if (point <= 0x7f) output.push(point);
      else if (point <= 0x7ff) output.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
      else if (point <= 0xffff) {
        output.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
      } else {
        output.push(
          0xf0 | (point >>> 18),
          0x80 | ((point >>> 12) & 0x3f),
          0x80 | ((point >>> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
      }
    }
    return new Uint8Array(output);
  }

  function concatBytes() {
    const chunks = Array.from(arguments);
    const size = chunks.reduce(function sum(total, chunk) { return total + chunk.length; }, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    chunks.forEach(function append(chunk) {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  function u32be(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      fail("INVALID_U32", "数值超出 U32BE 编码范围。");
    }
    const output = new Uint8Array(4);
    new DataView(output.buffer).setUint32(0, value, false);
    return output;
  }

  function u64be(high, low) {
    const output = new Uint8Array(8);
    const view = new DataView(output.buffer);
    view.setUint32(0, high, false);
    view.setUint32(4, low, false);
    return output;
  }

  function lp(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 0xffffffff) {
      fail("INVALID_LENGTH_PREFIX", "字段无法使用 U32BE 长度前缀编码。");
    }
    return concatBytes(u32be(bytes.length), bytes);
  }

  function textBytes(value) {
    return lp(utf8Bytes(value));
  }

  function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  function sha256Bytes(input) {
    const bytes = typeof input === "string" ? utf8Bytes(input) : new Uint8Array(input);
    const bitLength = bytes.length * 8;
    const padding = (64 - ((bytes.length + 1 + 8) % 64)) % 64;
    const padded = new Uint8Array(bytes.length + 1 + padding + 8);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bitLength / UINT32_RANGE), false);
    view.setUint32(padded.length - 4, bitLength >>> 0, false);
    const hash = new Uint32Array(SHA256_INITIAL);
    const words = new Uint32Array(64);

    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
      for (let index = 16; index < 64; index += 1) {
        const a = words[index - 15];
        const b = words[index - 2];
        const sigma0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
        const sigma1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }
      let a = hash[0]; let b = hash[1]; let c = hash[2]; let d = hash[3];
      let e = hash[4]; let f = hash[5]; let g = hash[6]; let h = hash[7];
      for (let index = 0; index < 64; index += 1) {
        const big1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temp1 = (h + big1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0;
        const big0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (big0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
    }
    const output = new Uint8Array(32);
    const outputView = new DataView(output.buffer);
    hash.forEach(function write(word, index) { outputView.setUint32(index * 4, word, false); });
    return output;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(function hex(value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  function hex32(value, code, label) {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
      fail(code, label + "必须是 64 位小写十六进制文本。");
    }
    const output = new Uint8Array(32);
    for (let index = 0; index < 32; index += 1) {
      output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return output;
  }

  function sha256Hex(input) {
    return bytesToHex(sha256Bytes(input));
  }

  function isCanonicalIso(value) {
    return typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
  }

  function requireIso(value, code, label) {
    if (!isCanonicalIso(value)) fail(code, label + "必须是规范 UTC ISO 时间。");
    return value;
  }

  function normalizeLine(value, label) {
    if (typeof value !== "string") fail("INVALID_INPUT", label + "必须是文本。");
    if (/[\r\n]/.test(value)) fail("INVALID_INPUT", label + "不能包含换行符。");
    assertNoLoneSurrogates(value, "INVALID_INPUT", label);
    const normalized = value.normalize("NFC").replace(TRIM_EDGES, "");
    if (!normalized) fail("INVALID_INPUT", label + "不能为空。");
    const encoded = utf8Bytes(normalized, "INVALID_INPUT", label);
    if (encoded.length > MAX_LABEL_BYTES) {
      fail("INVALID_INPUT", label + "的 UTF-8 长度不能超过 4096 字节。");
    }
    return normalized;
  }

  function parseTextLines(value, label) {
    if (typeof value !== "string") fail("INVALID_INPUT", (label || "输入") + "必须是文本。");
    assertNoLoneSurrogates(value, "INVALID_INPUT", label || "输入");
    return value.replace(/\r\n?/g, "\n").split("\n").map(function normalize(value, index) {
      const name = (label || "输入") + "第 " + (index + 1) + " 行";
      const normalized = value.normalize("NFC").replace(TRIM_EDGES, "");
      if (!normalized) return "";
      if (utf8Bytes(normalized, "INVALID_INPUT", name).length > MAX_LABEL_BYTES) {
        fail("INVALID_INPUT", name + "的 UTF-8 长度不能超过 4096 字节。");
      }
      return normalized;
    }).filter(Boolean);
  }

  function encodeInput(input) {
    const chunks = [u32be(input.students.length)];
    input.students.forEach(function student(value) { chunks.push(textBytes(value)); });
    chunks.push(u32be(input.papers.length));
    input.papers.forEach(function paper(value) { chunks.push(textBytes(value)); });
    const output = concatBytes.apply(null, chunks);
    if (output.length > MAX_INPUT_BYTES) fail("INVALID_INPUT", "规范输入编码不能超过 8 MiB。");
    return output;
  }

  function canonicalizeInput(studentNames, papers) {
    if (!Array.isArray(studentNames) || !Array.isArray(papers)) {
      fail("INVALID_INPUT", "学生名单和论文列表必须是数组。");
    }
    if (studentNames.length < 9 || studentNames.length % 3 !== 0 || studentNames.length > MAX_ITEMS) {
      fail("INVALID_INPUT", "学生人数必须为 9 至 10000 之间的 3 的倍数。");
    }
    if (studentNames.length !== papers.length) fail("INVALID_INPUT", "学生人数必须与论文数量一致。");
    const students = studentNames.map(function student(value, index) {
      return normalizeLine(value, "第 " + (index + 1) + " 位学生姓名");
    });
    const normalizedPapers = papers.map(function paper(value, index) {
      return normalizeLine(value, "第 " + (index + 1) + " 篇论文标题");
    });
    function ensureUnique(values, label) {
      if (new Set(values).size !== values.length) fail("INVALID_INPUT", label + "含有规范化后完全相同的项目。");
    }
    ensureUnique(students, "学生名单");
    ensureUnique(normalizedPapers, "论文列表");
    const input = { students: students, papers: normalizedPapers };
    encodeInput(input);
    return input;
  }

  function canonicalInput(studentNames, papers) {
    const input = canonicalizeInput(studentNames, papers);
    return JSON.stringify({ students: input.students, papers: input.papers });
  }

  function inputDigest(studentNames, papers) {
    const input = canonicalizeInput(studentNames, papers);
    return bytesToHex(sha256Bytes(concatBytes(D_INPUT, lp(encodeInput(input)))));
  }

  function secureRandom32() {
    const cryptoApi = root && root.crypto && typeof root.crypto.getRandomValues === "function"
      ? root.crypto
      : nodeCrypto && nodeCrypto.webcrypto && typeof nodeCrypto.webcrypto.getRandomValues === "function"
        ? nodeCrypto.webcrypto
        : null;
    if (!cryptoApi) fail("SECURE_RANDOM_UNAVAILABLE", "Web Crypto 不可用，无法安全生成随机种子。");
    const bytes = new Uint8Array(32);
    try {
      cryptoApi.getRandomValues(bytes);
    } catch (_error) {
      fail("SECURE_RANDOM_UNAVAILABLE", "Web Crypto 无法安全生成随机种子。");
    }
    return bytes;
  }

  function generateSeed() {
    return bytesToHex(secureRandom32());
  }

  function createPrngWithDomains(seedHex, inputDigestHex, keyDomain, blockDomain) {
    const seed = hex32(seedHex, "INVALID_SEED", "随机种子");
    const digest = hex32(inputDigestHex, "INVALID_INPUT_DIGEST", "输入摘要");
    const rngKey = sha256Bytes(concatBytes(keyDomain, seed, digest));
    let counterHigh = 0;
    let counterLow = 0;
    let block = new Uint8Array(0);
    let offset = 0;

    function refill() {
      block = sha256Bytes(concatBytes(blockDomain, rngKey, u64be(counterHigh, counterLow)));
      offset = 0;
      if (counterHigh === 0xffffffff && counterLow === 0xffffffff) {
        counterHigh = null;
        counterLow = null;
      } else {
        counterLow = (counterLow + 1) >>> 0;
        if (counterLow === 0) counterHigh = (counterHigh + 1) >>> 0;
      }
    }

    function nextBlockIfNeeded() {
      if (offset < block.length) return;
      if (counterHigh === null) fail("PRNG_EXHAUSTED", "SHA-256 counter 随机流已经耗尽。");
      refill();
    }

    function nextBytes(length) {
      if (!Number.isSafeInteger(length) || length < 0) fail("INVALID_RANDOM_LENGTH", "随机字节数量必须是非负整数。");
      const output = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        nextBlockIfNeeded();
        output[index] = block[offset];
        offset += 1;
      }
      return output;
    }

    function nextUint32() {
      const bytes = nextBytes(4);
      return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
    }

    function uniform(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
        fail("INVALID_RANDOM_BOUND", "无偏整数上限必须是 1..2^32 的整数。");
      }
      const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
      let value;
      do value = nextUint32(); while (value >= limit);
      return value % maxExclusive;
    }

    function shuffle(items) {
      if (!Array.isArray(items)) fail("INVALID_SHUFFLE_INPUT", "洗牌输入必须是数组。");
      const output = items.slice();
      for (let index = output.length - 1; index > 0; index -= 1) {
        const swap = uniform(index + 1);
        const value = output[index];
        output[index] = output[swap];
        output[swap] = value;
      }
      return output;
    }
    return { nextBytes: nextBytes, nextUint32: nextUint32, uniform: uniform, nextInt: uniform, shuffle: shuffle };
  }

  function createPrng(seedHex, inputDigestHex) {
    return createPrngWithDomains(seedHex, inputDigestHex, D_RNG_KEY, D_RNG_BLOCK);
  }

  function createPrngV5(seedHex, inputDigestHex, purpose) {
    if (purpose === undefined || purpose === "questions") {
      return createPrngWithDomains(
        seedHex,
        inputDigestHex,
        V5_D_QUESTION_RNG_KEY,
        V5_D_QUESTION_RNG_BLOCK,
      );
    }
    if (purpose === "presenters") {
      return createPrngWithDomains(
        seedHex,
        inputDigestHex,
        V5_D_PRESENTER_RNG_KEY,
        V5_D_PRESENTER_RNG_BLOCK,
      );
    }
    fail("INVALID_RANDOM_PURPOSE", "v5 随机流用途必须是 questions 或 presenters。");
  }

  function makePlan(input, seedHex) {
    const digest = inputDigest(input.students, input.papers);
    const random = createPrng(seedHex, digest);
    const counts = new Array(input.students.length).fill(0);
    const weeks = [];
    for (let weekIndex = 0; weekIndex < input.papers.length / 3; weekIndex += 1) {
      const levels = Array.from(new Set(counts)).sort(function ascending(a, b) { return a - b; });
      const selected = [];
      for (const level of levels) {
        const selectedSet = new Set(selected);
        const candidates = [];
        for (let index = 0; index < counts.length; index += 1) {
          if (counts[index] === level && !selectedSet.has(index)) candidates.push(index);
        }
        const shuffled = random.shuffle(candidates);
        selected.push.apply(selected, shuffled.slice(0, 9 - selected.length));
        if (selected.length === 9) break;
      }
      if (selected.length !== 9) fail("SCHEDULE_FAILED", "无法生成每周九人不重复的完整安排。");
      const weeklyOrder = random.shuffle(selected);
      const assignments = [];
      for (let paperOffset = 0; paperOffset < 3; paperOffset += 1) {
        assignments.push({
          paperIndex: weekIndex * 3 + paperOffset,
          studentIndexes: weeklyOrder.slice(paperOffset * 3, paperOffset * 3 + 3),
        });
      }
      selected.forEach(function increment(index) { counts[index] += 1; });
      weeks.push({ weekIndex: weekIndex, assignments: assignments });
    }
    if (counts.some(function invalid(count) { return count !== 3; })) {
      fail("SCHEDULE_FAILED", "无法生成每位学生恰好出现三次的完整安排。");
    }
    return { weeks: weeks };
  }

  function encodePlan(plan, itemCount) {
    const chunks = [u32be(plan.weeks.length)];
    plan.weeks.forEach(function week(week) {
      chunks.push(u32be(3));
      week.assignments.forEach(function assignment(assignment) {
        chunks.push(u32be(assignment.paperIndex), u32be(3));
        assignment.studentIndexes.forEach(function student(index) { chunks.push(u32be(index)); });
      });
    });
    if (itemCount !== plan.weeks.length * 3) fail("INVALID_PLAN", "计划论文数量不正确。");
    return concatBytes.apply(null, chunks);
  }

  function planDigest(plan, itemCount) {
    if (!Number.isInteger(itemCount) || itemCount < 9 || itemCount > MAX_ITEMS || itemCount % 3 !== 0) {
      fail("INVALID_PLAN", "计划人数必须是 9 至 10000 之间的 3 的倍数。");
    }
    inspectPlan(plan, itemCount);
    return bytesToHex(sha256Bytes(concatBytes(D_PLAN, lp(encodePlan(plan, itemCount)))));
  }

  function planToSchedule(input, plan, createdAt) {
    return {
      students: input.students.map(function student(name, index) {
        return { id: "student-" + (index + 1), name: name };
      }),
      weeks: plan.weeks.map(function week(week, weekIndex) {
        return {
          id: "week-" + (weekIndex + 1),
          assignments: week.assignments.map(function assignment(assignment) {
            return {
              paper: input.papers[assignment.paperIndex],
              studentIds: assignment.studentIndexes.map(function id(index) { return "student-" + (index + 1); }),
            };
          }),
          revealed: [false, false, false],
        };
      }),
      createdAt: createdAt,
    };
  }

  function createDeterministicSchedule(studentNames, papers, seedHex, options) {
    const input = canonicalizeInput(studentNames, papers);
    hex32(seedHex, "INVALID_SEED", "随机种子");
    const createdAt = options && options.createdAt !== undefined
      ? requireIso(options.createdAt, "INVALID_CREATED_AT", "抽签创建时间")
      : "1970-01-01T00:00:00.000Z";
    return planToSchedule(input, makePlan(input, seedHex), createdAt);
  }

  function receiptContext(issuedAt, count) {
    return concatBytes(
      textBytes(PROTOCOL_ID), textBytes(NORMALIZATION_ID), textBytes(RNG_ID), textBytes(SCHEDULE_ID),
      textBytes(issuedAt), u32be(count), u32be(count), u32be(3), u32be(3), u32be(3),
    );
  }

  function computeCommitment(studentNames, papers, seedHex, issuedAt) {
    const input = canonicalizeInput(studentNames, papers);
    const seed = hex32(seedHex, "INVALID_SEED", "随机种子");
    requireIso(issuedAt, "INVALID_ISSUED_AT", "承诺签发时间");
    const digest = hex32(inputDigest(input.students, input.papers), "INVALID_INPUT_DIGEST", "输入摘要");
    return bytesToHex(sha256Bytes(concatBytes(
      D_COMMIT,
      lp(receiptContext(issuedAt, input.students.length)),
      digest,
      seed,
    )));
  }

  function createAuditedSchedule(studentNames, papers, options) {
    const settings = options || {};
    const input = canonicalizeInput(studentNames, papers);
    const seedHex = settings.seedHex === undefined ? generateSeed() : settings.seedHex;
    hex32(seedHex, "INVALID_SEED", "随机种子");
    const issuedAt = settings.createdAt === undefined
      ? new Date().toISOString()
      : requireIso(settings.createdAt, "INVALID_CREATED_AT", "抽签创建时间");
    const plan = makePlan(input, seedHex);
    const schedule = planToSchedule(input, plan, issuedAt);
    schedule.audit = {
      protocolId: PROTOCOL_ID,
      normalizationId: NORMALIZATION_ID,
      rngId: RNG_ID,
      scheduleId: SCHEDULE_ID,
      issuedAt: issuedAt,
      inputDigest: inputDigest(input.students, input.papers),
      commitment: computeCommitment(input.students, input.papers, seedHex, issuedAt),
      planDigest: planDigest(plan, input.students.length),
      seedHex: seedHex,
      commitmentConfirmedAt: null,
    };
    return schedule;
  }

  function scheduleToPlan(schedule, input) {
    const indexById = new Map(schedule.students.map(function entry(student, index) { return [student.id, index]; }));
    return {
      weeks: schedule.weeks.map(function weekEntry(week, weekIndex) {
        return {
          weekIndex: weekIndex,
          assignments: week.assignments.map(function assignmentEntry(assignment, paperOffset) {
            const expectedPaperIndex = weekIndex * 3 + paperOffset;
            if (assignment.paper !== input.papers[expectedPaperIndex]) {
              fail("INVALID_SCHEDULE", "论文顺序与规范输入不一致。");
            }
            return {
              paperIndex: expectedPaperIndex,
              studentIndexes: assignment.studentIds.map(function studentIndex(id) {
                if (!indexById.has(id)) fail("INVALID_SCHEDULE", "安排含有未知学生编号。");
                return indexById.get(id);
              }),
            };
          }),
        };
      }),
    };
  }

  function inspectPlan(plan, count) {
    exactKeys(plan, ["weeks"], "INVALID_PLAN", "零基计划");
    if (!Array.isArray(plan.weeks) || plan.weeks.length !== count / 3) {
      fail("INVALID_PLAN", "零基计划周数不正确。");
    }
    const totals = new Array(count).fill(0);
    const seenPapers = new Set();
    plan.weeks.forEach(function inspectWeek(week, weekIndex) {
      exactKeys(week, ["weekIndex", "assignments"], "INVALID_PLAN", "零基周次");
      if (week.weekIndex !== weekIndex || !Array.isArray(week.assignments) || week.assignments.length !== 3) {
        fail("INVALID_PLAN", "零基周次编号或论文数量不正确。");
      }
      const weekly = [];
      week.assignments.forEach(function inspectAssignment(assignment, offset) {
        exactKeys(assignment, ["paperIndex", "studentIndexes"], "INVALID_PLAN", "零基论文安排");
        const paperIndex = weekIndex * 3 + offset;
        if (assignment.paperIndex !== paperIndex || seenPapers.has(paperIndex) ||
            !Array.isArray(assignment.studentIndexes) || assignment.studentIndexes.length !== 3) {
          fail("INVALID_PLAN", "论文下标或提问学生数量不正确。");
        }
        seenPapers.add(paperIndex);
        assignment.studentIndexes.forEach(function inspectIndex(index) {
          if (!Number.isInteger(index) || index < 0 || index >= count) {
            fail("INVALID_PLAN", "学生下标超出范围。");
          }
          totals[index] += 1;
          weekly.push(index);
        });
      });
      if (new Set(weekly).size !== 9) fail("INVALID_PLAN", "同一周九名学生必须互不重复。");
    });
    if (seenPapers.size !== count || totals.some(function notThree(total) { return total !== 3; })) {
      fail("INVALID_PLAN", "论文覆盖或学生最终次数不正确。");
    }
    return clone(plan);
  }

  function inspectSchedule(schedule, withAudit) {
    exactKeys(
      schedule,
      withAudit ? ["students", "weeks", "createdAt", "audit"] : ["students", "weeks", "createdAt"],
      "INVALID_SCHEDULE",
      "抽签安排",
    );
    requireIso(schedule.createdAt, "INVALID_SCHEDULE", "抽签创建时间");
    if (!Array.isArray(schedule.students) || !Array.isArray(schedule.weeks)) {
      fail("INVALID_SCHEDULE", "抽签安排缺少学生或周次。");
    }
    const names = schedule.students.map(function inspectStudent(student, index) {
      exactKeys(student, ["id", "name"], "INVALID_SCHEDULE", "学生记录");
      if (student.id !== "student-" + (index + 1) || typeof student.name !== "string") {
        fail("INVALID_SCHEDULE", "学生编号或姓名不正确。");
      }
      return student.name;
    });
    if (schedule.weeks.length !== names.length / 3) fail("INVALID_SCHEDULE", "周次数量不正确。");
    const papers = [];
    let complete = true;
    schedule.weeks.forEach(function inspectWeek(week, index) {
      exactKeys(week, ["id", "assignments", "revealed"], "INVALID_SCHEDULE", "周次记录");
      if (week.id !== "week-" + (index + 1) || !Array.isArray(week.assignments) ||
          week.assignments.length !== 3 || !Array.isArray(week.revealed) || week.revealed.length !== 3 ||
          week.revealed.some(function invalid(value) { return typeof value !== "boolean"; })) {
        fail("INVALID_SCHEDULE", "周次编号、论文数量或揭晓状态不正确。");
      }
      if (!week.revealed.every(Boolean)) complete = false;
      week.assignments.forEach(function inspectAssignment(assignment) {
        exactKeys(assignment, ["paper", "studentIds"], "INVALID_SCHEDULE", "论文安排");
        if (typeof assignment.paper !== "string" || !Array.isArray(assignment.studentIds) ||
            assignment.studentIds.length !== 3) fail("INVALID_SCHEDULE", "论文安排格式不正确。");
        papers.push(assignment.paper);
      });
    });
    const input = canonicalizeInput(names, papers);
    if (!arraysEqual(input.students, names) || !arraysEqual(input.papers, papers)) {
      fail("INVALID_SCHEDULE", "安排中的输入不是规范形。");
    }
    const plan = scheduleToPlan(schedule, input);
    inspectPlan(plan, names.length);
    return { input: input, plan: plan, complete: complete };
  }

  function inspectAudit(schedule) {
    const inspected = inspectSchedule(schedule, true);
    exactKeys(schedule.audit, [
      "protocolId", "normalizationId", "rngId", "scheduleId", "issuedAt", "inputDigest",
      "commitment", "planDigest", "seedHex", "commitmentConfirmedAt",
    ], "INVALID_AUDIT", "私密审计元数据");
    if (schedule.audit.protocolId !== PROTOCOL_ID || schedule.audit.normalizationId !== NORMALIZATION_ID ||
        schedule.audit.rngId !== RNG_ID || schedule.audit.scheduleId !== SCHEDULE_ID) {
      fail("UNSUPPORTED_PROTOCOL", "抽签审计协议标识不受支持。");
    }
    requireIso(schedule.audit.issuedAt, "INVALID_AUDIT", "承诺签发时间");
    if (schedule.audit.issuedAt !== schedule.createdAt) fail("INVALID_AUDIT", "承诺签发时间与安排创建时间不一致。");
    hex32(schedule.audit.inputDigest, "INVALID_AUDIT", "输入摘要");
    hex32(schedule.audit.commitment, "INVALID_AUDIT", "承诺码");
    hex32(schedule.audit.planDigest, "INVALID_AUDIT", "计划摘要");
    hex32(schedule.audit.seedHex, "INVALID_AUDIT", "随机种子");
    if (schedule.audit.commitmentConfirmedAt !== null) {
      requireIso(schedule.audit.commitmentConfirmedAt, "INVALID_AUDIT", "承诺确认时间");
      if (Date.parse(schedule.audit.commitmentConfirmedAt) < Date.parse(schedule.createdAt)) {
        fail("INVALID_AUDIT", "承诺确认时间不能早于安排创建时间。");
      }
    } else if (schedule.weeks.some(function hasReveal(week) { return week.revealed.some(Boolean); })) {
      fail("INVALID_AUDIT", "尚未确认公开承诺的安排不能包含已揭晓结果。");
    }
    const digest = inputDigest(inspected.input.students, inspected.input.papers);
    const commitment = computeCommitment(
      inspected.input.students,
      inspected.input.papers,
      schedule.audit.seedHex,
      schedule.audit.issuedAt,
    );
    const replay = makePlan(inspected.input, schedule.audit.seedHex);
    const replayDigest = planDigest(replay, inspected.input.students.length);
    if (digest !== schedule.audit.inputDigest || commitment !== schedule.audit.commitment ||
        replayDigest !== schedule.audit.planDigest || JSON.stringify(replay) !== JSON.stringify(inspected.plan)) {
      fail("AUDIT_MISMATCH", "私密审计数据无法重现当前安排。");
    }
    return inspected;
  }

  const RECEIPT_KEYS = [
    "format", "version", "protocolId", "normalizationId", "rngId", "scheduleId", "issuedAt",
    "studentCount", "paperCount", "papersPerWeek", "studentsPerPaper", "finalSelectionsPerStudent",
    "inputDigest", "commitment",
  ];

  function createPublicReceipt(schedule) {
    const inspected = inspectAudit(schedule);
    return {
      format: RECEIPT_FORMAT,
      version: FORMAT_VERSION,
      protocolId: PROTOCOL_ID,
      normalizationId: NORMALIZATION_ID,
      rngId: RNG_ID,
      scheduleId: SCHEDULE_ID,
      issuedAt: schedule.audit.issuedAt,
      studentCount: inspected.input.students.length,
      paperCount: inspected.input.papers.length,
      papersPerWeek: 3,
      studentsPerPaper: 3,
      finalSelectionsPerStudent: 3,
      inputDigest: schedule.audit.inputDigest,
      commitment: schedule.audit.commitment,
    };
  }

  function parsePublicReceipt(candidate) {
    exactKeys(candidate, RECEIPT_KEYS, "INVALID_RECEIPT", "公开承诺凭证");
    if (candidate.format !== RECEIPT_FORMAT) fail("INVALID_RECEIPT", "这不是论文提问抽签公开承诺凭证。");
    if (candidate.version !== FORMAT_VERSION) fail("UNSUPPORTED_VERSION", "公开承诺凭证版本不受支持。");
    if (candidate.protocolId !== PROTOCOL_ID || candidate.normalizationId !== NORMALIZATION_ID ||
        candidate.rngId !== RNG_ID || candidate.scheduleId !== SCHEDULE_ID) {
      fail("UNSUPPORTED_PROTOCOL", "公开承诺凭证协议标识不受支持。");
    }
    requireIso(candidate.issuedAt, "INVALID_RECEIPT", "承诺签发时间");
    if (!Number.isInteger(candidate.studentCount) || candidate.studentCount < 9 ||
        candidate.studentCount > MAX_ITEMS || candidate.studentCount % 3 !== 0 ||
        candidate.paperCount !== candidate.studentCount || candidate.papersPerWeek !== 3 ||
        candidate.studentsPerPaper !== 3 || candidate.finalSelectionsPerStudent !== 3) {
      fail("INVALID_RECEIPT", "公开承诺凭证的固定数量不正确。");
    }
    hex32(candidate.inputDigest, "INVALID_RECEIPT", "输入摘要");
    hex32(candidate.commitment, "INVALID_RECEIPT", "承诺码");
    return clone(candidate);
  }

  function confirmCommitment(schedule, at) {
    inspectAudit(schedule);
    if (schedule.weeks.some(function revealed(week) { return week.revealed.some(Boolean); })) {
      fail("COMMITMENT_TOO_LATE", "必须在揭晓任何结果前确认已公开承诺。");
    }
    const confirmedAt = requireIso(at === undefined ? new Date().toISOString() : at,
      "INVALID_CONFIRMATION_TIME", "承诺确认时间");
    if (Date.parse(confirmedAt) < Date.parse(schedule.createdAt)) {
      fail("INVALID_CONFIRMATION_TIME", "承诺确认时间不能早于安排创建时间。");
    }
    if (schedule.audit.commitmentConfirmedAt && schedule.audit.commitmentConfirmedAt !== confirmedAt) {
      fail("COMMITMENT_ALREADY_CONFIRMED", "承诺已经确认，不能改写确认时间。");
    }
    schedule.audit.commitmentConfirmedAt = confirmedAt;
    return schedule;
  }

  function createFinalReport(schedule, options) {
    const inspected = inspectAudit(schedule);
    if (!inspected.complete) fail("COURSE_INCOMPLETE", "全部论文揭晓后才能创建最终审计报告。");
    if (!schedule.audit.commitmentConfirmedAt) fail("COMMITMENT_NOT_CONFIRMED", "公开承诺尚未确认。");
    const completedAt = options && options.completedAt !== undefined
      ? requireIso(options.completedAt, "INVALID_COMPLETION_TIME", "报告生成时间")
      : new Date().toISOString();
    if (Date.parse(completedAt) < Date.parse(schedule.audit.commitmentConfirmedAt)) {
      fail("INVALID_COMPLETION_TIME", "报告生成时间不能早于承诺确认时间。");
    }
    return {
      format: REPORT_FORMAT,
      version: FORMAT_VERSION,
      completedAt: completedAt,
      receipt: createPublicReceipt(schedule),
      seed: schedule.audit.seedHex,
      students: inspected.input.students.slice(),
      papers: inspected.input.papers.slice(),
      plan: clone(inspected.plan),
      planDigest: schedule.audit.planDigest,
    };
  }

  const REPORT_KEYS = [
    "format", "version", "completedAt", "receipt", "seed", "students", "papers", "plan", "planDigest",
  ];

  function parseFinalReport(candidate) {
    exactKeys(candidate, REPORT_KEYS, "INVALID_REPORT", "最终审计报告");
    if (candidate.format !== REPORT_FORMAT) fail("INVALID_REPORT", "这不是论文提问抽签最终审计报告。");
    if (candidate.version !== FORMAT_VERSION) fail("UNSUPPORTED_VERSION", "最终审计报告版本不受支持。");
    requireIso(candidate.completedAt, "INVALID_REPORT", "报告生成时间");
    const receipt = parsePublicReceipt(candidate.receipt);
    if (Date.parse(candidate.completedAt) < Date.parse(receipt.issuedAt)) {
      fail("INVALID_REPORT", "报告生成时间不能早于承诺签发时间。");
    }
    hex32(candidate.seed, "INVALID_REPORT", "报告随机种子");
    hex32(candidate.planDigest, "INVALID_REPORT", "计划摘要");
    const input = canonicalizeInput(candidate.students, candidate.papers);
    if (!arraysEqual(input.students, candidate.students) || !arraysEqual(input.papers, candidate.papers)) {
      fail("INVALID_REPORT", "报告输入不是规范形。");
    }
    if (receipt.studentCount !== input.students.length || receipt.paperCount !== input.papers.length) {
      fail("INVALID_REPORT", "报告输入数量与内嵌承诺凭证不一致。");
    }
    inspectPlan(candidate.plan, input.students.length);
    return clone(candidate);
  }

  function receiptsEqual(left, right) {
    return RECEIPT_KEYS.every(function same(key) { return left[key] === right[key]; });
  }

  function verificationFailure(code, message) {
    return { ok: false, code: code, message: message };
  }

  function verifyReceiptAndReport(receiptCandidate, reportCandidate) {
    let receipt;
    let report;
    try {
      receipt = parsePublicReceipt(receiptCandidate);
      report = parseFinalReport(reportCandidate);
    } catch (error) {
      return verificationFailure(
        error && error.code ? error.code : "INVALID_AUDIT_FILE",
        error instanceof Error ? error.message : "审计文件格式不正确。",
      );
    }
    const receiptMatches = receiptsEqual(receipt, report.receipt);
    const digest = inputDigest(report.students, report.papers);
    const inputDigestMatches = digest === receipt.inputDigest;
    const commitment = computeCommitment(report.students, report.papers, report.seed, receipt.issuedAt);
    const commitmentMatches = commitment === receipt.commitment;
    const replayedPlan = makePlan({ students: report.students, papers: report.papers }, report.seed);
    const reportedPlanDigest = planDigest(report.plan, report.students.length);
    const replayedPlanDigest = planDigest(replayedPlan, report.students.length);
    // Compare the protocol's canonical binary encoding, not JSON member order.
    const replayMatches = replayedPlanDigest === reportedPlanDigest;
    const reportedPlanDigestMatches = reportedPlanDigest === report.planDigest;
    const replayPlanDigestMatches = replayedPlanDigest === report.planDigest;
    const ok = receiptMatches && inputDigestMatches && commitmentMatches && replayMatches &&
      reportedPlanDigestMatches && replayPlanDigestMatches;
    let code = "OK";
    let message = "审计通过：事前承诺、规范输入、随机种子与完整计划全部匹配。";
    if (!receiptMatches) { code = "RECEIPT_MISMATCH"; message = "外部承诺凭证与报告内凭证不一致。"; }
    else if (!inputDigestMatches) { code = "INPUT_DIGEST_MISMATCH"; message = "规范输入摘要不匹配。"; }
    else if (!commitmentMatches) { code = "COMMITMENT_MISMATCH"; message = "随机种子无法重现事前承诺。"; }
    else if (!reportedPlanDigestMatches) { code = "PLAN_DIGEST_MISMATCH"; message = "报告计划摘要不匹配。"; }
    else if (!replayMatches || !replayPlanDigestMatches) { code = "REPLAY_MISMATCH"; message = "随机种子重放计划与报告不一致。"; }
    return {
      ok: ok,
      code: code,
      message: message,
      receiptMatches: receiptMatches,
      inputDigestMatches: inputDigestMatches,
      commitmentMatches: commitmentMatches,
      reportedPlanDigestMatches: reportedPlanDigestMatches,
      replayPlanDigestMatches: replayPlanDigestMatches,
      replayMatches: replayMatches,
      inputDigest: digest,
      commitment: commitment,
      planDigest: replayedPlanDigest,
      students: report.students.slice(),
      papers: report.papers.slice(),
      replayedPlan: clone(replayedPlan),
    };
  }

  function verifyFinalReport(report, receipt) {
    if (receipt === undefined) {
      return verificationFailure("RECEIPT_REQUIRED", "必须同时提供事前保存的公开承诺凭证。");
    }
    return verifyReceiptAndReport(receipt, report);
  }

  const legacyV4 = {
    ALGORITHM_VERSION: PROTOCOL_ID,
    FORMAT_VERSION: FORMAT_VERSION,
    NORMALIZATION_ID: NORMALIZATION_ID,
    PROTOCOL_ID: PROTOCOL_ID,
    RECEIPT_FORMAT: RECEIPT_FORMAT,
    REPORT_FORMAT: REPORT_FORMAT,
    RNG_ID: RNG_ID,
    SCHEDULE_ID: SCHEDULE_ID,
    computeCommitment: computeCommitment,
    confirmCommitment: confirmCommitment,
    createAuditedSchedule: createAuditedSchedule,
    createDeterministicSchedule: createDeterministicSchedule,
    createFinalReport: createFinalReport,
    createPrng: createPrng,
    createPublicReceipt: createPublicReceipt,
    inputDigest: inputDigest,
    parseFinalReport: parseFinalReport,
    parsePublicReceipt: parsePublicReceipt,
    planDigest: planDigest,
    verifyFinalReport: verifyFinalReport,
    verifyReceiptAndReport: verifyReceiptAndReport,
  };

  function inputDigestV5(studentNames, papers) {
    const input = canonicalizeInput(studentNames, papers);
    return bytesToHex(sha256Bytes(concatBytes(V5_D_INPUT, lp(encodeInput(input)))));
  }

  function makePlanV5(input, seedHex) {
    const digest = inputDigestV5(input.students, input.papers);
    const questionRandom = createPrngV5(seedHex, digest, "questions");
    const presenterRandom = createPrngV5(seedHex, digest, "presenters");
    const counts = new Array(input.students.length).fill(0);
    const weeks = [];

    // First create the questioner plan using the same fairness rule as v4,
    // but from the v5 domain-separated random stream.
    for (let weekIndex = 0; weekIndex < input.papers.length / 3; weekIndex += 1) {
      const levels = Array.from(new Set(counts)).sort(function ascending(a, b) { return a - b; });
      const selected = [];
      for (const level of levels) {
        const selectedSet = new Set(selected);
        const candidates = [];
        for (let index = 0; index < counts.length; index += 1) {
          if (counts[index] === level && !selectedSet.has(index)) candidates.push(index);
        }
        const shuffled = questionRandom.shuffle(candidates);
        selected.push.apply(selected, shuffled.slice(0, 9 - selected.length));
        if (selected.length === 9) break;
      }
      if (selected.length !== 9) fail("SCHEDULE_FAILED", "无法生成每周九人不重复的完整安排。");
      const weeklyOrder = questionRandom.shuffle(selected);
      const assignments = [];
      for (let paperOffset = 0; paperOffset < 3; paperOffset += 1) {
        assignments.push({
          paperIndex: weekIndex * 3 + paperOffset,
          studentIndexes: weeklyOrder.slice(paperOffset * 3, paperOffset * 3 + 3),
          presenterIndex: null,
        });
      }
      selected.forEach(function increment(index) { counts[index] += 1; });
      weeks.push({ weekIndex: weekIndex, assignments: assignments });
    }
    if (counts.some(function invalid(count) { return count !== 3; })) {
      fail("SCHEDULE_FAILED", "无法生成每位学生恰好提问三次的完整安排。");
    }

    // A candidate permutation maps paper index -> presenter index. Rejection
    // sampling from complete Fisher-Yates permutations is uniform over every
    // valid one-to-one matching. A matching always exists here: the forbidden
    // questioner graph is 3-regular and N >= 9.
    const assignments = weeks.flatMap(function flatten(week) { return week.assignments; });
    const indexes = Array.from({ length: input.students.length }, function indexValue(_value, index) {
      return index;
    });
    let presenters = null;
    for (let attempt = 0; attempt < V5_MAX_PRESENTER_ATTEMPTS; attempt += 1) {
      const candidate = presenterRandom.shuffle(indexes);
      const valid = candidate.every(function presenterAllowed(presenterIndex, paperIndex) {
        return !assignments[paperIndex].studentIndexes.includes(presenterIndex);
      });
      if (valid) {
        presenters = candidate;
        break;
      }
    }
    if (!presenters) {
      fail("PRESENTER_MATCHING_FAILED", "报告人均匀匹配超过安全重试上限，请重新生成。");
    }
    assignments.forEach(function assignPresenter(assignment, paperIndex) {
      assignment.presenterIndex = presenters[paperIndex];
    });
    return { weeks: weeks };
  }

  function inspectPlanV5(plan, count) {
    exactKeys(plan, ["weeks"], "INVALID_PLAN", "v5 零基计划");
    if (!Array.isArray(plan.weeks) || plan.weeks.length !== count / 3) {
      fail("INVALID_PLAN", "v5 零基计划周数不正确。");
    }
    const questionTotals = new Array(count).fill(0);
    const presenters = [];
    const seenPapers = new Set();
    plan.weeks.forEach(function inspectWeekV5(week, weekIndex) {
      exactKeys(week, ["weekIndex", "assignments"], "INVALID_PLAN", "v5 零基周次");
      if (week.weekIndex !== weekIndex || !Array.isArray(week.assignments) || week.assignments.length !== 3) {
        fail("INVALID_PLAN", "v5 零基周次编号或论文数量不正确。");
      }
      const weeklyQuestioners = [];
      week.assignments.forEach(function inspectAssignmentV5(assignment, offset) {
        exactKeys(assignment, ["paperIndex", "studentIndexes", "presenterIndex"],
          "INVALID_PLAN", "v5 零基论文安排");
        const paperIndex = weekIndex * 3 + offset;
        if (assignment.paperIndex !== paperIndex || seenPapers.has(paperIndex) ||
            !Array.isArray(assignment.studentIndexes) || assignment.studentIndexes.length !== 3) {
          fail("INVALID_PLAN", "v5 论文下标或提问学生数量不正确。");
        }
        seenPapers.add(paperIndex);
        assignment.studentIndexes.forEach(function inspectQuestioner(index) {
          if (!Number.isInteger(index) || index < 0 || index >= count) {
            fail("INVALID_PLAN", "v5 提问学生下标超出范围。");
          }
          questionTotals[index] += 1;
          weeklyQuestioners.push(index);
        });
        if (!Number.isInteger(assignment.presenterIndex) || assignment.presenterIndex < 0 ||
            assignment.presenterIndex >= count) {
          fail("INVALID_PLAN", "v5 报告人下标超出范围。");
        }
        if (assignment.studentIndexes.includes(assignment.presenterIndex)) {
          fail("INVALID_PLAN", "v5 同一篇论文的报告人不得与提问人重复。");
        }
        presenters.push(assignment.presenterIndex);
      });
      if (new Set(weeklyQuestioners).size !== 9) {
        fail("INVALID_PLAN", "v5 同一周九名提问学生必须互不重复。");
      }
    });
    if (seenPapers.size !== count || questionTotals.some(function notThree(total) { return total !== 3; })) {
      fail("INVALID_PLAN", "v5 论文覆盖或学生提问总次数不正确。");
    }
    if (presenters.length !== count || new Set(presenters).size !== count) {
      fail("INVALID_PLAN", "v5 每位学生必须恰好报告一篇论文。");
    }
    return clone(plan);
  }

  function encodePlanV5(plan, itemCount) {
    const chunks = [u32be(plan.weeks.length)];
    plan.weeks.forEach(function encodeWeekV5(week) {
      chunks.push(u32be(3));
      week.assignments.forEach(function encodeAssignmentV5(assignment) {
        chunks.push(u32be(assignment.paperIndex), u32be(3));
        assignment.studentIndexes.forEach(function encodeQuestioner(index) { chunks.push(u32be(index)); });
        chunks.push(u32be(1), u32be(assignment.presenterIndex));
      });
    });
    if (itemCount !== plan.weeks.length * 3) fail("INVALID_PLAN", "v5 计划论文数量不正确。");
    return concatBytes.apply(null, chunks);
  }

  function planDigestV5(plan, itemCount) {
    if (!Number.isInteger(itemCount) || itemCount < 9 || itemCount > MAX_ITEMS || itemCount % 3 !== 0) {
      fail("INVALID_PLAN", "v5 计划人数必须是 9 至 10000 之间的 3 的倍数。");
    }
    inspectPlanV5(plan, itemCount);
    return bytesToHex(sha256Bytes(concatBytes(V5_D_PLAN, lp(encodePlanV5(plan, itemCount)))));
  }

  function planToScheduleV5(input, plan, createdAt) {
    return {
      students: input.students.map(function studentV5(name, index) {
        return { id: "student-" + (index + 1), name: name };
      }),
      weeks: plan.weeks.map(function weekV5(week, weekIndex) {
        return {
          id: "week-" + (weekIndex + 1),
          assignments: week.assignments.map(function assignmentV5(assignment) {
            return {
              paper: input.papers[assignment.paperIndex],
              studentIds: assignment.studentIndexes.map(function questionerId(index) {
                return "student-" + (index + 1);
              }),
              presenterId: "student-" + (assignment.presenterIndex + 1),
            };
          }),
          revealed: [false, false, false],
        };
      }),
      createdAt: createdAt,
    };
  }

  function createDeterministicScheduleV5(studentNames, papers, seedHex, options) {
    const input = canonicalizeInput(studentNames, papers);
    hex32(seedHex, "INVALID_SEED", "随机种子");
    const createdAt = options && options.createdAt !== undefined
      ? requireIso(options.createdAt, "INVALID_CREATED_AT", "抽签创建时间")
      : "1970-01-01T00:00:00.000Z";
    return planToScheduleV5(input, makePlanV5(input, seedHex), createdAt);
  }

  function receiptContextV5(issuedAt, count) {
    return concatBytes(
      textBytes(V5_PROTOCOL_ID), textBytes(V5_NORMALIZATION_ID), textBytes(V5_RNG_ID),
      textBytes(V5_SCHEDULE_ID), textBytes(issuedAt),
      u32be(count), u32be(count), u32be(3), u32be(3), u32be(3), u32be(1), u32be(1),
    );
  }

  function computeCommitmentV5(studentNames, papers, seedHex, issuedAt) {
    const input = canonicalizeInput(studentNames, papers);
    const seed = hex32(seedHex, "INVALID_SEED", "随机种子");
    requireIso(issuedAt, "INVALID_ISSUED_AT", "承诺签发时间");
    const digest = hex32(inputDigestV5(input.students, input.papers), "INVALID_INPUT_DIGEST", "输入摘要");
    return bytesToHex(sha256Bytes(concatBytes(
      V5_D_COMMIT,
      lp(receiptContextV5(issuedAt, input.students.length)),
      digest,
      seed,
    )));
  }

  function createAuditedScheduleV5(studentNames, papers, options) {
    const settings = options || {};
    const input = canonicalizeInput(studentNames, papers);
    const seedHex = settings.seedHex === undefined ? generateSeed() : settings.seedHex;
    hex32(seedHex, "INVALID_SEED", "随机种子");
    const issuedAt = settings.createdAt === undefined
      ? new Date().toISOString()
      : requireIso(settings.createdAt, "INVALID_CREATED_AT", "抽签创建时间");
    const plan = makePlanV5(input, seedHex);
    const schedule = planToScheduleV5(input, plan, issuedAt);
    schedule.audit = {
      protocolId: V5_PROTOCOL_ID,
      normalizationId: V5_NORMALIZATION_ID,
      rngId: V5_RNG_ID,
      scheduleId: V5_SCHEDULE_ID,
      issuedAt: issuedAt,
      inputDigest: inputDigestV5(input.students, input.papers),
      commitment: computeCommitmentV5(input.students, input.papers, seedHex, issuedAt),
      planDigest: planDigestV5(plan, input.students.length),
      seedHex: seedHex,
      commitmentConfirmedAt: null,
    };
    return schedule;
  }

  function scheduleToPlanV5(schedule, input) {
    const indexById = new Map(schedule.students.map(function entryV5(student, index) {
      return [student.id, index];
    }));
    return {
      weeks: schedule.weeks.map(function weekEntryV5(week, weekIndex) {
        return {
          weekIndex: weekIndex,
          assignments: week.assignments.map(function assignmentEntryV5(assignment, paperOffset) {
            const expectedPaperIndex = weekIndex * 3 + paperOffset;
            if (assignment.paper !== input.papers[expectedPaperIndex]) {
              fail("INVALID_SCHEDULE", "v5 论文顺序与规范输入不一致。");
            }
            if (!indexById.has(assignment.presenterId)) {
              fail("INVALID_SCHEDULE", "v5 安排含有未知报告人编号。");
            }
            return {
              paperIndex: expectedPaperIndex,
              studentIndexes: assignment.studentIds.map(function questionerIndex(id) {
                if (!indexById.has(id)) fail("INVALID_SCHEDULE", "v5 安排含有未知提问学生编号。");
                return indexById.get(id);
              }),
              presenterIndex: indexById.get(assignment.presenterId),
            };
          }),
        };
      }),
    };
  }

  function inspectScheduleV5(schedule, withAudit) {
    exactKeys(
      schedule,
      withAudit ? ["students", "weeks", "createdAt", "audit"] : ["students", "weeks", "createdAt"],
      "INVALID_SCHEDULE",
      "v5 抽签安排",
    );
    requireIso(schedule.createdAt, "INVALID_SCHEDULE", "v5 抽签创建时间");
    if (!Array.isArray(schedule.students) || !Array.isArray(schedule.weeks)) {
      fail("INVALID_SCHEDULE", "v5 抽签安排缺少学生或周次。");
    }
    const names = schedule.students.map(function inspectStudentV5(student, index) {
      exactKeys(student, ["id", "name"], "INVALID_SCHEDULE", "v5 学生记录");
      if (student.id !== "student-" + (index + 1) || typeof student.name !== "string") {
        fail("INVALID_SCHEDULE", "v5 学生编号或姓名不正确。");
      }
      return student.name;
    });
    if (schedule.weeks.length !== names.length / 3) fail("INVALID_SCHEDULE", "v5 周次数量不正确。");
    const papers = [];
    let complete = true;
    schedule.weeks.forEach(function inspectWeekScheduleV5(week, index) {
      exactKeys(week, ["id", "assignments", "revealed"], "INVALID_SCHEDULE", "v5 周次记录");
      if (week.id !== "week-" + (index + 1) || !Array.isArray(week.assignments) ||
          week.assignments.length !== 3 || !Array.isArray(week.revealed) || week.revealed.length !== 3 ||
          week.revealed.some(function invalid(value) { return typeof value !== "boolean"; })) {
        fail("INVALID_SCHEDULE", "v5 周次编号、论文数量或揭晓状态不正确。");
      }
      if (!week.revealed.every(Boolean)) complete = false;
      week.assignments.forEach(function inspectAssignmentScheduleV5(assignment) {
        exactKeys(assignment, ["paper", "studentIds", "presenterId"],
          "INVALID_SCHEDULE", "v5 论文安排");
        if (typeof assignment.paper !== "string" || !Array.isArray(assignment.studentIds) ||
            assignment.studentIds.length !== 3 || typeof assignment.presenterId !== "string") {
          fail("INVALID_SCHEDULE", "v5 论文安排格式不正确。");
        }
        papers.push(assignment.paper);
      });
    });
    const input = canonicalizeInput(names, papers);
    if (!arraysEqual(input.students, names) || !arraysEqual(input.papers, papers)) {
      fail("INVALID_SCHEDULE", "v5 安排中的输入不是规范形。");
    }
    const plan = scheduleToPlanV5(schedule, input);
    inspectPlanV5(plan, names.length);
    return { input: input, plan: plan, complete: complete };
  }

  function inspectAuditV5(schedule) {
    const inspected = inspectScheduleV5(schedule, true);
    exactKeys(schedule.audit, [
      "protocolId", "normalizationId", "rngId", "scheduleId", "issuedAt", "inputDigest",
      "commitment", "planDigest", "seedHex", "commitmentConfirmedAt",
    ], "INVALID_AUDIT", "v5 私密审计元数据");
    if (schedule.audit.protocolId !== V5_PROTOCOL_ID ||
        schedule.audit.normalizationId !== V5_NORMALIZATION_ID ||
        schedule.audit.rngId !== V5_RNG_ID || schedule.audit.scheduleId !== V5_SCHEDULE_ID) {
      fail("UNSUPPORTED_PROTOCOL", "v5 抽签审计协议标识不受支持。");
    }
    requireIso(schedule.audit.issuedAt, "INVALID_AUDIT", "v5 承诺签发时间");
    if (schedule.audit.issuedAt !== schedule.createdAt) {
      fail("INVALID_AUDIT", "v5 承诺签发时间与安排创建时间不一致。");
    }
    hex32(schedule.audit.inputDigest, "INVALID_AUDIT", "v5 输入摘要");
    hex32(schedule.audit.commitment, "INVALID_AUDIT", "v5 承诺码");
    hex32(schedule.audit.planDigest, "INVALID_AUDIT", "v5 计划摘要");
    hex32(schedule.audit.seedHex, "INVALID_AUDIT", "v5 随机种子");
    if (schedule.audit.commitmentConfirmedAt !== null) {
      requireIso(schedule.audit.commitmentConfirmedAt, "INVALID_AUDIT", "v5 承诺确认时间");
      if (Date.parse(schedule.audit.commitmentConfirmedAt) < Date.parse(schedule.createdAt)) {
        fail("INVALID_AUDIT", "v5 承诺确认时间不能早于安排创建时间。");
      }
    } else if (schedule.weeks.some(function hasRevealV5(week) { return week.revealed.some(Boolean); })) {
      fail("INVALID_AUDIT", "v5 尚未确认公开承诺的安排不能包含已揭晓结果。");
    }
    const digest = inputDigestV5(inspected.input.students, inspected.input.papers);
    const commitment = computeCommitmentV5(
      inspected.input.students,
      inspected.input.papers,
      schedule.audit.seedHex,
      schedule.audit.issuedAt,
    );
    const replay = makePlanV5(inspected.input, schedule.audit.seedHex);
    const replayDigest = planDigestV5(replay, inspected.input.students.length);
    if (digest !== schedule.audit.inputDigest || commitment !== schedule.audit.commitment ||
        replayDigest !== schedule.audit.planDigest || JSON.stringify(replay) !== JSON.stringify(inspected.plan)) {
      fail("AUDIT_MISMATCH", "v5 私密审计数据无法重现当前提问人与报告人安排。");
    }
    return inspected;
  }

  const V5_RECEIPT_KEYS = [
    "format", "version", "protocolId", "normalizationId", "rngId", "scheduleId", "issuedAt",
    "studentCount", "paperCount", "papersPerWeek", "studentsPerPaper", "finalSelectionsPerStudent",
    "presentersPerPaper", "finalPresentationsPerStudent", "inputDigest", "commitment",
  ];

  function createPublicReceiptV5(schedule) {
    const inspected = inspectAuditV5(schedule);
    return {
      format: RECEIPT_FORMAT,
      version: V5_FORMAT_VERSION,
      protocolId: V5_PROTOCOL_ID,
      normalizationId: V5_NORMALIZATION_ID,
      rngId: V5_RNG_ID,
      scheduleId: V5_SCHEDULE_ID,
      issuedAt: schedule.audit.issuedAt,
      studentCount: inspected.input.students.length,
      paperCount: inspected.input.papers.length,
      papersPerWeek: 3,
      studentsPerPaper: 3,
      finalSelectionsPerStudent: 3,
      presentersPerPaper: 1,
      finalPresentationsPerStudent: 1,
      inputDigest: schedule.audit.inputDigest,
      commitment: schedule.audit.commitment,
    };
  }

  function parsePublicReceiptV5(candidate) {
    exactKeys(candidate, V5_RECEIPT_KEYS, "INVALID_RECEIPT", "v5 公开承诺凭证");
    if (candidate.format !== RECEIPT_FORMAT) fail("INVALID_RECEIPT", "这不是论文提问抽签公开承诺凭证。");
    if (candidate.version !== V5_FORMAT_VERSION) fail("UNSUPPORTED_VERSION", "v5 公开承诺凭证版本不受支持。");
    if (candidate.protocolId !== V5_PROTOCOL_ID || candidate.normalizationId !== V5_NORMALIZATION_ID ||
        candidate.rngId !== V5_RNG_ID || candidate.scheduleId !== V5_SCHEDULE_ID) {
      fail("UNSUPPORTED_PROTOCOL", "v5 公开承诺凭证协议标识不受支持。");
    }
    requireIso(candidate.issuedAt, "INVALID_RECEIPT", "v5 承诺签发时间");
    if (!Number.isInteger(candidate.studentCount) || candidate.studentCount < 9 ||
        candidate.studentCount > MAX_ITEMS || candidate.studentCount % 3 !== 0 ||
        candidate.paperCount !== candidate.studentCount || candidate.papersPerWeek !== 3 ||
        candidate.studentsPerPaper !== 3 || candidate.finalSelectionsPerStudent !== 3 ||
        candidate.presentersPerPaper !== 1 || candidate.finalPresentationsPerStudent !== 1) {
      fail("INVALID_RECEIPT", "v5 公开承诺凭证的固定数量不正确。");
    }
    hex32(candidate.inputDigest, "INVALID_RECEIPT", "v5 输入摘要");
    hex32(candidate.commitment, "INVALID_RECEIPT", "v5 承诺码");
    return clone(candidate);
  }

  function confirmCommitmentV5(schedule, at) {
    inspectAuditV5(schedule);
    if (schedule.weeks.some(function revealedV5(week) { return week.revealed.some(Boolean); })) {
      fail("COMMITMENT_TOO_LATE", "必须在揭晓任何结果前确认已公开承诺。");
    }
    const confirmedAt = requireIso(at === undefined ? new Date().toISOString() : at,
      "INVALID_CONFIRMATION_TIME", "v5 承诺确认时间");
    if (Date.parse(confirmedAt) < Date.parse(schedule.createdAt)) {
      fail("INVALID_CONFIRMATION_TIME", "v5 承诺确认时间不能早于安排创建时间。");
    }
    if (schedule.audit.commitmentConfirmedAt && schedule.audit.commitmentConfirmedAt !== confirmedAt) {
      fail("COMMITMENT_ALREADY_CONFIRMED", "v5 承诺已经确认，不能改写确认时间。");
    }
    schedule.audit.commitmentConfirmedAt = confirmedAt;
    return schedule;
  }

  function createFinalReportV5(schedule, options) {
    const inspected = inspectAuditV5(schedule);
    if (!inspected.complete) fail("COURSE_INCOMPLETE", "全部论文揭晓后才能创建最终审计报告。");
    if (!schedule.audit.commitmentConfirmedAt) fail("COMMITMENT_NOT_CONFIRMED", "公开承诺尚未确认。");
    const completedAt = options && options.completedAt !== undefined
      ? requireIso(options.completedAt, "INVALID_COMPLETION_TIME", "v5 报告生成时间")
      : new Date().toISOString();
    if (Date.parse(completedAt) < Date.parse(schedule.audit.commitmentConfirmedAt)) {
      fail("INVALID_COMPLETION_TIME", "v5 报告生成时间不能早于承诺确认时间。");
    }
    return {
      format: REPORT_FORMAT,
      version: V5_FORMAT_VERSION,
      completedAt: completedAt,
      receipt: createPublicReceiptV5(schedule),
      seed: schedule.audit.seedHex,
      students: inspected.input.students.slice(),
      papers: inspected.input.papers.slice(),
      plan: clone(inspected.plan),
      planDigest: schedule.audit.planDigest,
    };
  }

  const V5_REPORT_KEYS = [
    "format", "version", "completedAt", "receipt", "seed", "students", "papers", "plan", "planDigest",
  ];

  function parseFinalReportV5(candidate) {
    exactKeys(candidate, V5_REPORT_KEYS, "INVALID_REPORT", "v5 最终审计报告");
    if (candidate.format !== REPORT_FORMAT) fail("INVALID_REPORT", "这不是论文提问抽签最终审计报告。");
    if (candidate.version !== V5_FORMAT_VERSION) fail("UNSUPPORTED_VERSION", "v5 最终审计报告版本不受支持。");
    requireIso(candidate.completedAt, "INVALID_REPORT", "v5 报告生成时间");
    const receipt = parsePublicReceiptV5(candidate.receipt);
    if (Date.parse(candidate.completedAt) < Date.parse(receipt.issuedAt)) {
      fail("INVALID_REPORT", "v5 报告生成时间不能早于承诺签发时间。");
    }
    hex32(candidate.seed, "INVALID_REPORT", "v5 报告随机种子");
    hex32(candidate.planDigest, "INVALID_REPORT", "v5 计划摘要");
    const input = canonicalizeInput(candidate.students, candidate.papers);
    if (!arraysEqual(input.students, candidate.students) || !arraysEqual(input.papers, candidate.papers)) {
      fail("INVALID_REPORT", "v5 报告输入不是规范形。");
    }
    if (receipt.studentCount !== input.students.length || receipt.paperCount !== input.papers.length) {
      fail("INVALID_REPORT", "v5 报告输入数量与内嵌承诺凭证不一致。");
    }
    inspectPlanV5(candidate.plan, input.students.length);
    return clone(candidate);
  }

  function receiptsEqualV5(left, right) {
    return V5_RECEIPT_KEYS.every(function sameV5(key) { return left[key] === right[key]; });
  }

  function verifyReceiptAndReportV5(receiptCandidate, reportCandidate) {
    let receipt;
    let report;
    try {
      receipt = parsePublicReceiptV5(receiptCandidate);
      report = parseFinalReportV5(reportCandidate);
    } catch (error) {
      return verificationFailure(
        error && error.code ? error.code : "INVALID_AUDIT_FILE",
        error instanceof Error ? error.message : "v5 审计文件格式不正确。",
      );
    }
    try {
      const receiptMatches = receiptsEqualV5(receipt, report.receipt);
      const digest = inputDigestV5(report.students, report.papers);
      const inputDigestMatches = digest === receipt.inputDigest;
      const commitment = computeCommitmentV5(report.students, report.papers, report.seed, receipt.issuedAt);
      const commitmentMatches = commitment === receipt.commitment;
      const replayedPlan = makePlanV5({ students: report.students, papers: report.papers }, report.seed);
      const reportedPlanDigest = planDigestV5(report.plan, report.students.length);
      const replayedPlanDigest = planDigestV5(replayedPlan, report.students.length);
      const replayMatches = replayedPlanDigest === reportedPlanDigest;
      const reportedPlanDigestMatches = reportedPlanDigest === report.planDigest;
      const replayPlanDigestMatches = replayedPlanDigest === report.planDigest;
      const ok = receiptMatches && inputDigestMatches && commitmentMatches && replayMatches &&
        reportedPlanDigestMatches && replayPlanDigestMatches;
      let code = "OK";
      let message = "审计通过：事前承诺、规范输入、随机种子、提问人与报告人安排全部匹配。";
      if (!receiptMatches) { code = "RECEIPT_MISMATCH"; message = "外部承诺凭证与报告内凭证不一致。"; }
      else if (!inputDigestMatches) { code = "INPUT_DIGEST_MISMATCH"; message = "规范输入摘要不匹配。"; }
      else if (!commitmentMatches) { code = "COMMITMENT_MISMATCH"; message = "随机种子无法重现事前承诺。"; }
      else if (!reportedPlanDigestMatches) { code = "PLAN_DIGEST_MISMATCH"; message = "报告计划摘要不匹配。"; }
      else if (!replayMatches || !replayPlanDigestMatches) {
        code = "REPLAY_MISMATCH";
        message = "随机种子重放的提问人或报告人安排与报告不一致。";
      }
      return {
        ok: ok,
        code: code,
        message: message,
        receiptMatches: receiptMatches,
        inputDigestMatches: inputDigestMatches,
        commitmentMatches: commitmentMatches,
        reportedPlanDigestMatches: reportedPlanDigestMatches,
        replayPlanDigestMatches: replayPlanDigestMatches,
        replayMatches: replayMatches,
        inputDigest: digest,
        commitment: commitment,
        planDigest: replayedPlanDigest,
        students: report.students.slice(),
        papers: report.papers.slice(),
        replayedPlan: clone(replayedPlan),
      };
    } catch (error) {
      return verificationFailure(
        error && error.code ? error.code : "REPLAY_FAILED",
        error instanceof Error ? error.message : "v5 审计重放失败。",
      );
    }
  }

  function coreForSchedule(schedule) {
    const protocol = schedule && schedule.audit && schedule.audit.protocolId;
    if (protocol === PROTOCOL_ID) return legacyV4;
    if (protocol === V5_PROTOCOL_ID) return null;
    fail("UNSUPPORTED_PROTOCOL", "抽签安排的审计协议版本不受支持。");
  }

  function createPublicReceiptAny(schedule) {
    return coreForSchedule(schedule) === legacyV4
      ? legacyV4.createPublicReceipt(schedule)
      : createPublicReceiptV5(schedule);
  }

  function confirmCommitmentAny(schedule, at) {
    return coreForSchedule(schedule) === legacyV4
      ? legacyV4.confirmCommitment(schedule, at)
      : confirmCommitmentV5(schedule, at);
  }

  function createFinalReportAny(schedule, options) {
    return coreForSchedule(schedule) === legacyV4
      ? legacyV4.createFinalReport(schedule, options)
      : createFinalReportV5(schedule, options);
  }

  function parsePublicReceiptAny(candidate) {
    if (candidate && candidate.version === FORMAT_VERSION) return legacyV4.parsePublicReceipt(candidate);
    return parsePublicReceiptV5(candidate);
  }

  function parseFinalReportAny(candidate) {
    if (candidate && candidate.version === FORMAT_VERSION) return legacyV4.parseFinalReport(candidate);
    return parseFinalReportV5(candidate);
  }

  function verifyReceiptAndReportAny(receiptCandidate, reportCandidate) {
    const receiptVersion = receiptCandidate && receiptCandidate.version;
    const reportVersion = reportCandidate && reportCandidate.version;
    if (receiptVersion !== reportVersion) {
      return verificationFailure("VERSION_MISMATCH", "公开承诺与最终报告不是同一协议版本。");
    }
    if (receiptVersion === FORMAT_VERSION) {
      return legacyV4.verifyReceiptAndReport(receiptCandidate, reportCandidate);
    }
    return verifyReceiptAndReportV5(receiptCandidate, reportCandidate);
  }

  function verifyFinalReportAny(report, receipt) {
    if (receipt === undefined) {
      return verificationFailure("RECEIPT_REQUIRED", "必须同时提供事前保存的公开承诺凭证。");
    }
    return verifyReceiptAndReportAny(receipt, report);
  }

  return {
    ALGORITHM_VERSION: V5_PROTOCOL_ID,
    FORMAT_VERSION: V5_FORMAT_VERSION,
    NORMALIZATION_ID: V5_NORMALIZATION_ID,
    PROTOCOL_ID: V5_PROTOCOL_ID,
    RECEIPT_FORMAT: RECEIPT_FORMAT,
    REPORT_FORMAT: REPORT_FORMAT,
    RNG_ID: V5_RNG_ID,
    SCHEDULE_ID: V5_SCHEDULE_ID,
    canonicalInput: canonicalInput,
    canonicalizeInput: canonicalizeInput,
    computeCommitment: computeCommitmentV5,
    confirmCommitment: confirmCommitmentAny,
    createAuditedSchedule: createAuditedScheduleV5,
    createDeterministicSchedule: createDeterministicScheduleV5,
    createFinalReport: createFinalReportAny,
    createPrng: createPrngV5,
    createPublicReceipt: createPublicReceiptAny,
    generateSeed: generateSeed,
    inputDigest: inputDigestV5,
    legacyV4: legacyV4,
    parseFinalReport: parseFinalReportAny,
    parsePublicReceipt: parsePublicReceiptAny,
    parseTextLines: parseTextLines,
    planDigest: planDigestV5,
    sha256Hex: sha256Hex,
    verifyFinalReport: verifyFinalReportAny,
    verifyReceiptAndReport: verifyReceiptAndReportAny,
  };
});
