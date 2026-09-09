# 论文提问抽签 v4 算法与审计协议

本文定义 v4 抽签的规范化输入、随机数生成、排程、事前承诺和事后审计格式。文中的“必须”“不得”“应当”是协议要求；实现若偏离这些要求，必须使用新的协议或算法版本号，不能继续声称兼容 v4。

## 1. 目标与保证边界

v4 的目标是让任何学生只凭：

1. 抽签开始前保存的公开承诺凭证；
2. 全部抽签完成后取得的审计报告；
3. 一份符合本规范的独立验证器；

即可重算完整安排，并检查名单、论文、随机种子、最终安排是否与事前承诺一致。

v4 能证明的是：**一份已经公开并由学生保存的承诺，在公开之后没有被换成另一份输入、随机种子或安排。**

v4 单独不能证明：

- 承诺凭证确实在某个时间之前生成；凭证中的 `issuedAt` 只是本机自报时间。
- 组织者在公开承诺之前没有反复生成随机种子并挑选喜欢的安排。
- 组织者使用的是未经修改的网页、验证器或操作系统。
- 浏览器扩展、同源网页、恶意脚本或取得设备权限的人没有提前读取私密随机种子。
- 页面展示过的结果一定与报告相同；学生仍应将自己看到或保存的结果与验证器重放结果核对。

因此，组织者必须在第一次揭晓前，把完整承诺值发送到班级群、邮件或其他会保留第三方时间记录的渠道。群消息的服务端时间可以提供“何时已经公开”的外部证据；网页自身的时间不能提供这种证据。

如果使用场景还要求抵御“公开前挑种子”，必须引入承诺之后才产生、且不受组织者单方控制的随机量，具体见第 10 节。

## 2. 固定标识与基本类型

v4 使用以下精确 ASCII 标识：

```text
PROTOCOL_ID      = paper-question-picker/v4
NORMALIZATION_ID = nfc-lines/v1
RNG_ID           = sha256-ctr-u64be-u32be-reject/v1
SCHEDULE_ID      = min-count-fisher-yates/v1
```

域分离标签为下列 UTF-8 字节，末尾的 `\0` 是一个值为 `0x00` 的字节，不是两个可见字符：

```text
D_INPUT     = UTF8("paper-question-picker/input/v4\0")
D_COMMIT    = UTF8("paper-question-picker/commitment/v4\0")
D_RNG_KEY   = UTF8("paper-question-picker/rng-key/v4\0")
D_RNG_BLOCK = UTF8("paper-question-picker/rng-block/v4\0")
D_PLAN      = UTF8("paper-question-picker/plan/v4\0")
```

编码原语：

- `UTF8(s)`：不带 BOM 的标准 UTF-8 编码。含未配对 UTF-16 代理项的字符串必须拒绝，不能静默替换为 `U+FFFD`。
- `U32BE(n)`：无符号 32 位大端整数，允许范围为 `0..2^32-1`。
- `U64BE(n)`：无符号 64 位大端整数，允许范围为 `0..2^64-1`。
- `LP(b)`：`U32BE(b.length) || b`。
- `TEXT(s)`：`LP(UTF8(s))`。
- `||`：字节串连接。
- `SHA256(b)`：对字节串 `b` 计算 SHA-256，结果为 32 个原始字节。
- 对外 JSON 中的 32 字节值一律编码为 64 个小写十六进制字符，不带 `0x`、空格或分隔符。解析器必须拒绝非规范编码。

协议散列不得改用普通字符串拼接，也不得直接依赖一般 JSON 文本的键顺序、空白或转义方式。

## 3. 输入规范化

### 3.1 从文本框得到有序数组

学生名单和论文列表分别按以下顺序处理：

1. 将 `CRLF` 和单独的 `CR` 都视为换行，与 `LF` 等价。
2. 按换行拆成行。
3. 拒绝含未配对 UTF-16 代理项的行。
4. 对每一行执行 Unicode NFC 规范化。
5. 删除行首、行尾属于下列固定集合的字符：`U+0009..U+000D`、`U+0020`、`U+00A0`、`U+1680`、`U+2000..U+200A`、`U+2028`、`U+2029`、`U+202F`、`U+205F`、`U+3000`、`U+FEFF`。
6. 丢弃处理后为空的行。
7. 保留剩余行的原始顺序；内部空白、大小写和标点不得改变。

实现必须把规范化后的两个有序数组展示给组织者确认。承诺针对这两个数组，不针对原始文本框字节。

规范化后完全相同的两个学生名称或两个论文标题必须拒绝。v4 不使用 `localeCompare`、`toLocaleLowerCase` 或依赖浏览器语言环境的大小写规则；需要区分同名学生时，应在名称中人工加入稳定标识。

### 3.2 输入约束

设学生数组为 `students`，论文数组为 `papers`，长度均为 `N`。输入必须满足：

- `N >= 9`；
- `N` 是 3 的倍数；
- `students.length === papers.length`；
- v4 站点配置限制 `N <= 10000`；
- 每个规范化名称或标题的 UTF-8 长度为 `1..4096` 字节；
- 第 3.3 节的 `INPUT_BYTES` 总长度不超过 8 MiB。

学生和论文的协议身份都是它们在规范化数组中的零基下标。显示名称不是身份键。

### 3.3 输入字节与输入摘要

```text
INPUT_BYTES =
    U32BE(N)
 || TEXT(students[0])
 || ...
 || TEXT(students[N-1])
 || U32BE(N)
 || TEXT(papers[0])
 || ...
 || TEXT(papers[N-1])

inputDigest = SHA256(D_INPUT || LP(INPUT_BYTES))
```

输入顺序属于承诺内容。即使名称和标题集合相同，只要顺序不同，`inputDigest` 通常就不同。

## 4. 随机种子与确定性随机流

### 4.1 随机种子

每次新抽签必须调用 Web Crypto：

```js
crypto.getRandomValues(new Uint8Array(32))
```

取得恰好 32 个随机字节作为 `seed`。Web Crypto 不可用或调用失败时必须停止，绝不能回退到 `Math.random()`、当前时间、UUID 或用户姓名等低熵来源。

同一次抽签只能有一个 `seed`。要求重新生成时必须创建一次全新的抽签和全新的承诺，旧承诺不得被原地覆盖。

### 4.2 随机流密钥

```text
rngKey = SHA256(D_RNG_KEY || seed || inputDigest)
```

把输入摘要加入密钥派生，可避免相同种子在不同输入上复用完全相同的随机流。

### 4.3 SHA-256 counter 字节流

计数器 `counter` 从 0 开始。第 `counter` 个 32 字节块为：

```text
block(counter) = SHA256(D_RNG_BLOCK || rngKey || U64BE(counter))
```

随机流是 `block(0) || block(1) || ...`。消费者必须从第一个字节开始按顺序读取，不能跳块、回退或并行改变消费顺序。计数器超过 `2^64-1` 时必须报错停止。

每次需要无符号 32 位数时，从流中连续读取 4 字节并按大端解释为 `x`。不能用会产生有符号 32 位结果的 JavaScript 位运算替代规范读取；推荐 `DataView.getUint32(offset, false)`。

## 5. 无偏整数与 Fisher–Yates

### 5.1 拒绝采样

`uniform(n)` 返回 `0..n-1` 的均匀整数。`n` 必须是 `1..2^32` 范围内的整数：

```text
limit = floor(2^32 / n) * n
循环：
    x = 从随机流读取一个 U32BE
    若 x >= limit：丢弃 x 并继续
    否则返回 x mod n
```

被拒绝的 `x` 已被消费，不能复用。实现不得直接使用 `x mod n` 而省略拒绝步骤。

### 5.2 洗牌

`shuffle(A)` 返回数组副本，不修改调用方的原数组。对副本执行以下精确的逆向 Fisher–Yates：

```text
for i = A.length - 1 down to 1:
    j = uniform(i + 1)
    swap A[i], A[j]
return A
```

长度为 0 或 1 的数组不消费随机字节。

## 6. 完整排程算法

每周有 3 篇论文，每篇抽取 3 名学生，因此每周选择 9 名互不重复的学生。论文按规范化输入顺序每 3 篇组成一周。

算法只使用零基学生下标和论文下标：

```text
counts = 长度为 N、全部为 0 的整数数组
weeks = []

for weekIndex = 0 .. N/3 - 1:
    selected = []

    levels = counts 在本周开始时出现过的不同数值，按数值升序排列
    for each level in levels:
        candidates = 按学生下标 0..N-1 升序扫描，
                     取 counts[index] == level 且尚未进入 selected 的下标
        candidates = shuffle(candidates)
        从 candidates 开头依次追加，直到 candidates 用完或 selected 长度达到 9
        若 selected 长度达到 9，立即结束 levels 循环

    若 selected 长度不等于 9：报错

    weeklyOrder = shuffle(selected)
    对 paperOffset = 0, 1, 2：
        paperIndex = weekIndex * 3 + paperOffset
        studentIndexes = weeklyOrder[paperOffset*3 .. paperOffset*3+2]
        记录 { paperIndex, studentIndexes }

    对 selected 中每个学生下标执行 counts[index] += 1

结束后，若任一 counts[index] 不等于 3：报错
```

重要的随机消费规则：

- `levels` 是本周开始时的快照，本周 9 人选完后才增加 `counts`。
- 每个 `candidates` 必须完整执行 Fisher–Yates，即使最终只会取它的前几项。
- 候选数组的洗牌先发生；9 人选齐后，再单独洗牌一次 `selected`。
- 不得用集合或对象的未规定枚举顺序决定候选顺序。
- 排程函数不得读取系统时间、时区、语言环境、DOM 状态或任何额外随机源。

## 7. 计划编码

完整计划包含 `N/3` 周和 `N` 篇论文。每篇论文的三名学生按 `weeklyOrder` 中的顺序记录：

```text
PLAN_BYTES =
    U32BE(N / 3)
 || 对 weekIndex = 0..N/3-1：
      U32BE(3)
   || 对该周 paperOffset = 0..2：
        U32BE(paperIndex)
     || U32BE(3)
     || U32BE(studentIndexes[0])
     || U32BE(studentIndexes[1])
     || U32BE(studentIndexes[2])

planDigest = SHA256(D_PLAN || LP(PLAN_BYTES))
```

`revealed`、动画状态、当前周、生成时间和操作日志都不属于确定性计划。它们不得影响 `PLAN_BYTES` 或重放结果。

## 8. 公开承诺凭证

### 8.1 凭证字段

公开凭证精确包含以下字段，不允许额外字段：

```json
{
  "format": "paper-question-picker-commitment",
  "version": 4,
  "protocolId": "paper-question-picker/v4",
  "normalizationId": "nfc-lines/v1",
  "rngId": "sha256-ctr-u64be-u32be-reject/v1",
  "scheduleId": "min-count-fisher-yates/v1",
  "issuedAt": "规范 UTC ISO 8601 时间",
  "studentCount": 12,
  "paperCount": 12,
  "papersPerWeek": 3,
  "studentsPerPaper": 3,
  "finalSelectionsPerStudent": 3,
  "inputDigest": "64 位小写十六进制",
  "commitment": "64 位小写十六进制"
}
```

`issuedAt` 必须是 `YYYY-MM-DDTHH:mm:ss.sssZ` 形式，但它只用于绑定显示元数据，不能当作可信时间戳。

### 8.2 承诺公式

```text
CONTEXT_BYTES =
    TEXT(PROTOCOL_ID)
 || TEXT(NORMALIZATION_ID)
 || TEXT(RNG_ID)
 || TEXT(SCHEDULE_ID)
 || TEXT(issuedAt)
 || U32BE(N)
 || U32BE(N)
 || U32BE(3)       // papersPerWeek
 || U32BE(3)       // studentsPerPaper
 || U32BE(3)       // finalSelectionsPerStudent

commitment = SHA256(
    D_COMMIT
 || LP(CONTEXT_BYTES)
 || inputDigest
 || seed
)
```

公开凭证必须通过字段白名单从内部状态构造。它不得包含：

- `seed` 或其可逆编码；
- counter、`rngKey`、随机块或拒绝采样记录；
- 完整计划、尚未揭晓的学生下标或其他未来结果；
- 私有恢复数据、浏览器存储快照或姓名到匿名 ID 的私有映射。

`inputDigest` 不直接包含明文，但它是未加盐的输入摘要，不提供加密或匿名性；知道候选名单或论文顺序的人可以离线验证猜测。`commitment` 对 seed 和未来计划的隐藏性依赖 `seed` 确实是不可预测的 32 字节随机量。

学生必须保存完整的公开凭证 JSON，课后验证器需要其中的全部字段。全部 64 位 `commitment` 可用于人工核对，但裸 commitment 或仅显示前 8 位的短码都不能替代完整凭证验证。

## 9. 最终审计报告与验证

最终审计报告只能在全部论文都已揭晓之后导出，并精确包含：

- 报告格式和版本；
- 规范 UTC ISO 报告生成时间 `completedAt`；
- 第 8 节的完整原始承诺凭证；
- 64 位小写十六进制 `seed`；
- 规范化后的有序 `students` 和 `papers`；
- 以零基论文下标和学生下标表示的完整计划；
- `planDigest`。

协议与算法标识位于内嵌的原始承诺凭证中，报告顶层不重复这些字段，也不允许其他额外字段。

独立验证器必须让学生分别提供“事前保存的公开凭证”和“最终审计报告”，并按顺序执行：

1. 严格检查两份数据的格式、版本、长度和类型。
2. 检查报告内凭证与学生事前保存的凭证逐字段一致。
3. 按第 3 节重新规范化或确认报告输入已经处于规范形，并计算 `inputDigest`。
4. 检查人数、论文数、固定规则和 `inputDigest` 与凭证一致。
5. 用报告中的 `seed` 按第 8.2 节重算 `commitment`。
6. 按第 4 至第 6 节从头重放完整计划。
7. 按第 7 节重算 `planDigest`，并逐项比较重放计划与报告计划。
8. 独立检查公平性不变量：每周恰有 3 篇、每篇恰有 3 人、同周 9 人不重复、每篇论文只出现一次、每位学生最终恰好 3 次、所有下标均在范围内。
9. 显示规范化输入、重放结果、完整摘要和每项检查结果。验证失败时必须给出具体失败项，不能只显示笼统错误。

只验证审计报告自己携带的凭证，不能证明凭证在揭晓前已经存在。验证器必须明确提示这一限制。

`verify.html` 及其同目录脚本、样式可以作为一个完整部署包下载并断网运行；在线使用时，文件内容也只在当前浏览器中处理。验证器不发送文件内容，不使用第三方脚本，不从 URL 查询参数读取 seed 或报告。它必须把导入 JSON 当作不可信数据，限制文件大小和数组长度，并对姓名、标题和错误信息做 HTML 转义。

验证器应保留固定的 v4 实现；将来发布 v5 时不得偷偷改变 v4 的重放规则。生产排程器和独立验证器最好有两份独立实现，并由固定测试向量交叉验证。

## 10. 重生成与公开前挑种子

本地界面可以减少误操作，但不能从密码学上阻止组织者在公开承诺前执行以下行为：生成 seed、查看计划、不满意就删除状态并重来。即使按钮被禁用，有设备控制权的人仍可修改代码或清除浏览器数据。

最低要求：

- 第一次揭晓前明确要求组织者把承诺发送到外部群聊等渠道。
- 新建抽签必须产生新的凭证；重置前应把旧记录保留在历史存档中，不得原地覆盖旧承诺。
- 页面和验证器必须说明：v4 基础流程只提供发布后的防篡改证据，不证明 seed 未经筛选。

如需抵御单方挑种子，应采用两阶段流程：

1. 组织者生成 32 字节私密量 `organizerSecret`，先公开
   `SHA256(UTF8("paper-question-picker/organizer-commit/v4\0") || inputDigest || organizerSecret)`。
2. 在该承诺已有外部时间证据之后，取得组织者此前无法预测的公开随机量 `beacon`，例如多人现场贡献或预先约定时刻的公开随机源。
3. 计算
   `seed = SHA256(UTF8("paper-question-picker/final-seed/v4\0") || organizerSecret || inputDigest || LP(beacon))`。
4. 最终报告同时公开 `organizerSecret` 和规范化的 `beacon`，验证器检查两阶段关系。

只要至少有一个在第一阶段之后产生、未被组织者预知的诚实随机贡献，组织者就不能单方预筛最终 seed。实际流程还必须事先规定贡献顺序、截止时间以及最后贡献者拒绝披露时的处理办法。基础 v4 不默认声称提供这项更强保证。

## 11. 本地存储、备份与隐私

未完成抽签时，`seed` 可以推导全部未来结果，必须视为秘密。完整预排计划具有同样敏感性。

当前 GitHub Pages 项目地址位于 `zjwulbx.github.io` 源下。浏览器存储按 origin 隔离，不按路径隔离，因此同一账号下其他 `zjwulbx.github.io/...` Pages 项目的 JavaScript 也能读取同一 `localStorage`。CSP 不能阻止另一个同源页面读取该存储。若要在浏览器中长期保存明文 seed，部署方应使用只承载本应用的独立域名或子域；否则应使用仅内存状态，或由用户口令保护的加密私有恢复数据。

文件类型必须清楚分开：

- **公开承诺凭证**：不含 seed 和未来计划，可以在揭晓前公开。
- **私有恢复备份**：为了跨设备继续未完成抽签，可能包含 seed；必须显著标记“机密”，最好使用带随机 salt、版本化 KDF 参数和认证加密的口令加密格式。
- **最终审计报告**：含 seed、完整输入和完整计划，只能在全部揭晓后由用户明确确认导出。

不得把私有恢复备份包装成看似可公开的“普通完整备份”。seed 不得进入 URL、控制台日志、分析服务、错误上报、公开 DOM 属性或公开剪贴板内容。应用不应加载第三方分析脚本。

最终审计报告可能包含学生姓名、论文标题和完整分配关系，属于班级隐私数据，不应自动上传或默认公开。需要公开互联网审计时，建议从一开始就以随机、不含姓名的参与者 ID 和论文 ID 作为协议输入，并把实名映射通过班级内渠道单独提供。姓名的普通散列不是可靠匿名化。

## 12. 旧版历史与迁移

v1、v2、v3 没有保存本规范的 32 字节 seed、输入摘要、算法版本和事前承诺，无法还原为可重放的 v4 记录。

迁移时必须：

- 原样保留旧记录可恢复的已揭晓内容；
- 明确标记为 `legacy-unverifiable` 或等价状态；
- 不得为旧记录伪造 seed、承诺或“验证通过”状态；
- 不得把旧记录中的未揭晓预排计划放入公开承诺或公开审计报告；
- 使用新的存储版本或 key，以“复制、校验、提交”方式迁移；失败时不得覆盖或删除旧数据，重复执行迁移必须幂等。

v4 私有备份导入后，应用必须从 seed 和规范化输入重新计算 `inputDigest`、`commitment` 和完整计划，不能直接信任备份中的计划。相同承诺在多个标签页或设备上的进度发生分叉时，只能在每个已揭晓结果都与重放计划一致的前提下合并进度，不能仅按本机时间戳覆盖。

## 13. 最低验收清单

发布 v4 前至少应满足：

- 固定一个包含中文、组合字符、emoji、CRLF 和边界空白的测试向量；Chrome、Firefox、Safari 和独立参考实现得到完全相同的 `inputDigest`、`commitment`、最初随机块、拒绝采样序列、完整计划和 `planDigest`。
- 覆盖 `uniform(1)`、`uniform(2)`、`uniform(3)`、`uniform(9)`、`uniform(255)`、`uniform(256)`、`uniform(257)` 和被强制拒绝的边界值。
- seed、输入、顺序、算法标识、时间、规则、承诺或计划任意改变一个字节，验证必须失败。
- 无 Web Crypto 时生成失败，代码中不存在 `Math.random()` 回退路径。
- 公开凭证经自动扫描确认不含 seed、随机状态或任何未揭晓学生分配。
- 未完成时不能导出最终审计报告；私有恢复文件有清晰的机密提示，计划、种子或承诺被篡改时必须安全失败。若未来增加口令加密，错误口令也必须安全失败。
- 验证器要求单独输入学生事前保存的凭证；只给最终报告时不得声称已证明事前承诺。
- 验证器断网可用，对超大 JSON、未知版本、坏十六进制、越界下标、原型键和含 HTML 的姓名安全失败。
- 使用不同实现对多个 `N` 和至少 10,000 个固定 seed 交叉重放，结果逐字节一致且全部公平性不变量成立。
- v1 至 v3 迁移后仍明确显示“旧版、不可重放验证”；迁移中断不得覆盖或删除旧数据，重试不产生重复记录。

## 14. 已发布固定测试向量

以下向量用于让第三方实现逐字节核对 v4。学生依次为 `学生1` 至 `学生12`，论文依次为 `论文1` 至 `论文12`；两个数组均按数字升序排列。其他输入为：

```text
seed     = 0000000000000000000000000000000000000000000000000000000000000000
issuedAt = 2026-09-09T00:00:00.000Z
```

预期摘要与随机流开头为：

```text
inputDigest = c405489f4ec183129f2cde38e2807d80b59cf41631db27e152b0a565ea9e551b
commitment  = a7742f176fd52f6fc25d27d43d551fe55b2f5001af489ea5882429fccde5f61b
planDigest  = 93f49494657ed4e2bd29578f96535488638f7b31df5dd98d5ee131ede04f1394
前四个 U32 = 66490067, 1330020163, 3924755527, 3067868633
```

完整计划使用协议规定的零基下标：

```json
{
  "weeks": [
    {"weekIndex": 0, "assignments": [
      {"paperIndex": 0, "studentIndexes": [5, 3, 4]},
      {"paperIndex": 1, "studentIndexes": [1, 6, 9]},
      {"paperIndex": 2, "studentIndexes": [2, 8, 0]}
    ]},
    {"weekIndex": 1, "assignments": [
      {"paperIndex": 3, "studentIndexes": [5, 7, 9]},
      {"paperIndex": 4, "studentIndexes": [2, 1, 10]},
      {"paperIndex": 5, "studentIndexes": [6, 11, 4]}
    ]},
    {"weekIndex": 2, "assignments": [
      {"paperIndex": 6, "studentIndexes": [0, 8, 6]},
      {"paperIndex": 7, "studentIndexes": [10, 3, 1]},
      {"paperIndex": 8, "studentIndexes": [4, 11, 7]}
    ]},
    {"weekIndex": 3, "assignments": [
      {"paperIndex": 9, "studentIndexes": [7, 0, 3]},
      {"paperIndex": 10, "studentIndexes": [5, 2, 10]},
      {"paperIndex": 11, "studentIndexes": [9, 8, 11]}
    ]}
  ]
}
```
