# 论文报告与提问抽签 v5 算法与审计协议

本文定义 v5 的规范化输入、确定性随机流、提问人排程、报告人匹配、事前承诺和事后审计格式。文中的“必须”“不得”“应当”是协议要求；实现若改变任何会影响字节或抽签结果的步骤，必须改用新的协议或算法版本号。

v4 已冻结且继续受支持。它只分配提问人，完整旧规范见 [ALGORITHM-v4.md](ALGORITHM-v4.md)；任何实现都不得用 v5 规则重新解释 v4 凭证或报告。

## 1. 角色规则与保证边界

设规范化后的学生数和论文数均为 `N`，且 `N >= 9`、`N` 是 3 的倍数。v5 预先生成全程唯一的一份计划：

- 每周按论文输入顺序安排 3 篇论文；
- 每篇论文有 3 位提问人；同一周 9 个提问名额由 9 位不同学生承担；
- 每位学生在全部课程中恰好提问 3 次；
- 每篇论文有 1 位报告人；每位学生在全部课程中恰好报告 1 篇；
- 一篇论文的报告人不得是该篇的 3 位提问人；
- 报告人可以为其他论文提问，包括同一周内的其他论文。禁止“跨论文重复”专指同一学生不得报告两篇论文，不代表报告角色与其他论文的提问角色互斥。

学生拿到抽签前的公开承诺凭证、全部结束后的最终审计报告和独立验证器后，可以重算完整计划，检查输入、随机种子、报告人与提问人安排是否与事前承诺一致。

v5 能证明的是：一份已经公开并由学生保存的承诺，在公开之后没有被换成另一份输入、随机种子或安排。它单独不能证明：

- 凭证确实在所声称的时间生成；`issuedAt` 是本机自报时间；
- 组织者在公开凭证前没有反复生成并挑选种子；
- 运行网页、验证器、浏览器或操作系统没有被修改；
- 页面曾经展示的内容与最终报告完全相同。

因此，第一次揭晓前必须把完整承诺 JSON 发到班级群、邮件等带外部时间记录的渠道。学生也应保存自己看到的结果，与最终重放结果核对。

## 2. 固定标识与编码原语

v5 使用以下精确 ASCII 标识：

```text
PROTOCOL_ID      = paper-question-picker/v5
NORMALIZATION_ID = nfc-lines/v1
RNG_ID           = sha256-ctr-split-u64be-u32be-reject/v2
SCHEDULE_ID      = min-count-plus-uniform-presenter-matching/v2
```

域分离标签为下列 UTF-8 字节；末尾的 `\0` 是一个 `0x00` 字节：

```text
D_INPUT               = UTF8("paper-question-picker/input/v5\0")
D_COMMIT              = UTF8("paper-question-picker/commitment/v5\0")
D_QUESTION_RNG_KEY    = UTF8("paper-question-picker/rng-key/questions/v5\0")
D_QUESTION_RNG_BLOCK  = UTF8("paper-question-picker/rng-block/questions/v5\0")
D_PRESENTER_RNG_KEY   = UTF8("paper-question-picker/rng-key/presenters/v5\0")
D_PRESENTER_RNG_BLOCK = UTF8("paper-question-picker/rng-block/presenters/v5\0")
D_PLAN                = UTF8("paper-question-picker/plan/v5\0")
```

编码原语：

- `UTF8(s)`：无 BOM 的标准 UTF-8；含未配对 UTF-16 代理项的字符串必须拒绝。
- `U32BE(n)`：无符号 32 位大端整数，范围 `0..2^32-1`。
- `U64BE(n)`：无符号 64 位大端整数，范围 `0..2^64-1`。
- `LP(b)`：`U32BE(b.length) || b`。
- `TEXT(s)`：`LP(UTF8(s))`。
- `||`：字节串连接。
- `SHA256(b)`：SHA-256 的 32 字节原始结果。

JSON 中的 32 字节值必须写成 64 位小写十六进制，不带 `0x` 或分隔符。协议散列不得依赖普通字符串拼接或 JSON 键顺序。

## 3. 输入规范化与摘要

学生名单和论文列表分别按以下顺序处理：

1. 把 `CRLF` 和单独的 `CR` 都视为 `LF`；
2. 按换行拆分；
3. 拒绝含未配对 UTF-16 代理项的行；
4. 对每行执行 Unicode NFC；
5. 删除行首尾属于以下固定集合的字符：`U+0009..U+000D`、`U+0020`、`U+00A0`、`U+1680`、`U+2000..U+200A`、`U+2028`、`U+2029`、`U+202F`、`U+205F`、`U+3000`、`U+FEFF`；
6. 丢弃空行；
7. 保留剩余行顺序，不改变内部空白、大小写或标点。

两个数组内部都不得出现规范化后完全相同的项目。站点还要求：

- `students.length === papers.length === N`；
- `9 <= N <= 10000`，且 `N` 是 3 的倍数；
- 每项 UTF-8 长度为 `1..4096` 字节；
- 下述 `INPUT_BYTES` 不超过 8 MiB。

学生和论文的协议身份都是规范化数组中的零基下标：

```text
INPUT_BYTES =
    U32BE(N)
 || TEXT(students[0]) || ... || TEXT(students[N-1])
 || U32BE(N)
 || TEXT(papers[0])   || ... || TEXT(papers[N-1])

inputDigest = SHA256(D_INPUT || LP(INPUT_BYTES))
```

输入顺序属于承诺内容。

## 4. 随机种子和两条独立随机流

每次新建抽签必须由 Web Crypto 取得恰好 32 个随机字节：

```js
crypto.getRandomValues(new Uint8Array(32))
```

失败时必须停止，绝不能退回 `Math.random()`、时间戳或 UUID。

提问人和报告人使用同一个 `seed`，但使用两个域分离的随机流，避免报告人匹配的重试改变提问人结果。对用途 `role`：

```text
role = questions:
    KEY_DOMAIN   = D_QUESTION_RNG_KEY
    BLOCK_DOMAIN = D_QUESTION_RNG_BLOCK

role = presenters:
    KEY_DOMAIN   = D_PRESENTER_RNG_KEY
    BLOCK_DOMAIN = D_PRESENTER_RNG_BLOCK

rngKey = SHA256(KEY_DOMAIN || seed || inputDigest)
block(counter) = SHA256(BLOCK_DOMAIN || rngKey || U64BE(counter))
```

`counter` 从 0 开始；随机字节流为 `block(0) || block(1) || ...`。每个流分别维护自己的 counter 和读取位置。读取 `U32` 时连续取 4 字节并按大端解释；counter 超出 `2^64-1` 必须停止。

## 5. 无偏整数与洗牌

`uniform(n)` 返回 `0..n-1` 的均匀整数，`n` 必须位于 `1..2^32`：

```text
limit = floor(2^32 / n) * n
循环：
    x = 从当前随机流读取一个 U32BE
    若 x >= limit：丢弃并继续
    否则返回 x mod n
```

`shuffle(A)` 必须复制输入，并在副本上执行逆向 Fisher–Yates：

```text
for i = A.length - 1 down to 1:
    j = uniform(i + 1)
    swap A[i], A[j]
return A
```

长度 0 或 1 的数组不消耗随机字节。

## 6. 提问人排程

论文按规范化输入顺序每 3 篇组成一周。只使用 `questions` 随机流：

```text
counts = 长度 N、初值全 0
weeks = []

for weekIndex = 0 .. N/3-1:
    selected = []
    levels = counts 在本周开始时的不同值，升序

    for level in levels:
        candidates = 按学生下标 0..N-1 升序扫描，
                     取 counts[index] == level 且不在 selected 的下标
        candidates = shuffle(candidates)
        从头追加到 selected，直到 candidates 用完或 selected 长度为 9
        若 selected 长度为 9：结束 levels 循环

    若 selected 长度不为 9：失败
    weeklyOrder = shuffle(selected)

    for paperOffset = 0..2:
        paperIndex = weekIndex * 3 + paperOffset
        studentIndexes = weeklyOrder[paperOffset*3 .. paperOffset*3+2]
        暂存 { paperIndex, studentIndexes }

    对 selected 中每个学生执行 counts[index] += 1

结束后若任一 counts[index] != 3：失败
```

`levels` 是本周开始时的快照；候选数组即使只取前几个也必须完整洗牌，选满 9 人后还要单独洗牌 `selected`。不得依赖集合、对象、语言环境或 DOM 的未规定顺序。

## 7. 报告人一对一匹配

把第 6 节得到的论文安排按 `paperIndex = 0..N-1` 展平。只使用 `presenters` 随机流。最多尝试 4096 次：

```text
indexes = [0, 1, ..., N-1]

for attempt = 0 .. 4095:
    candidate = shuffle(indexes)
    // candidate[paperIndex] 是该篇论文的候选报告人
    若对每个 paperIndex 都满足：
        candidate[paperIndex] 不在该篇 studentIndexes 中
    则接受 candidate 并停止

若 4096 次均未接受：安全失败，不创建抽签或承诺
```

被接受的 `candidate` 是一个全排列，因此每篇恰有 1 位报告人、每位学生恰好报告 1 篇。限制只检查“本篇报告人不属于本篇提问人”；同一学生可以提问其他论文。

### 7.1 为什么匹配一定存在

把论文和学生看成二分图。每篇禁止它自己的 3 位提问人；每位学生全程也恰好提问 3 篇，所以允许边构成一个 `(N-3)` 正则二分图。正则二分图满足 Hall 条件，因此至少存在一个覆盖全部论文和学生的完美匹配。

4096 是随机搜索的安全上限，不是“可能不存在匹配”的补丁。若把 SHA-256 流视为理想均匀随机源，每次完整洗牌在所有 `N!` 个排列中均匀；只接受有效排列，因此最终结果在所有有效报告人匹配中均匀。由 van der Waerden 下界，每次成功概率至少为 `((N-3)/N)^N`；在允许的最小规模 `N=9` 也不低于 `(2/3)^9 ≈ 2.60%`。连续 4096 次均失败的理想概率小于 `2×10^-47`。真的触及上限时实现必须停止，不能换用有偏后备算法。

## 8. 计划结构、编码与摘要

每篇计划对象为：

```json
{
  "paperIndex": 0,
  "studentIndexes": [1, 2, 3],
  "presenterIndex": 4
}
```

完整字节编码：

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
     || U32BE(1)
     || U32BE(presenterIndex)

planDigest = SHA256(D_PLAN || LP(PLAN_BYTES))
```

`U32BE(1)` 是报告人数的显式编码。揭晓状态、当前周、动画和操作日志不属于计划，不能影响摘要。

## 9. 公开承诺凭证

凭证必须精确包含以下字段，不允许额外字段：

```json
{
  "format": "paper-question-picker-commitment",
  "version": 5,
  "protocolId": "paper-question-picker/v5",
  "normalizationId": "nfc-lines/v1",
  "rngId": "sha256-ctr-split-u64be-u32be-reject/v2",
  "scheduleId": "min-count-plus-uniform-presenter-matching/v2",
  "issuedAt": "规范 UTC ISO 8601 时间",
  "studentCount": 12,
  "paperCount": 12,
  "papersPerWeek": 3,
  "studentsPerPaper": 3,
  "finalSelectionsPerStudent": 3,
  "presentersPerPaper": 1,
  "finalPresentationsPerStudent": 1,
  "inputDigest": "64 位小写十六进制",
  "commitment": "64 位小写十六进制"
}
```

`issuedAt` 必须为 `YYYY-MM-DDTHH:mm:ss.sssZ`。承诺上下文和公式为：

```text
CONTEXT_BYTES =
    TEXT(PROTOCOL_ID)
 || TEXT(NORMALIZATION_ID)
 || TEXT(RNG_ID)
 || TEXT(SCHEDULE_ID)
 || TEXT(issuedAt)
 || U32BE(N)   // studentCount
 || U32BE(N)   // paperCount
 || U32BE(3)   // papersPerWeek
 || U32BE(3)   // studentsPerPaper
 || U32BE(3)   // finalSelectionsPerStudent
 || U32BE(1)   // presentersPerPaper
 || U32BE(1)   // finalPresentationsPerStudent

commitment = SHA256(
    D_COMMIT
 || LP(CONTEXT_BYTES)
 || inputDigest
 || seed
)
```

公开凭证不得包含 seed、随机状态、计划、姓名、论文标题、未来结果或私有备份。`inputDigest` 是未加盐摘要，不等于匿名化；知道候选输入的人仍可离线验证猜测。人工核对应使用完整 64 位 commitment，短码只能辅助辨认。

## 10. 最终审计报告与验证顺序

最终报告只能在全部论文已经揭晓且用户此前确认公开了承诺后导出。它精确包含：

- `format = paper-question-picker-final-audit`、`version = 5`；
- 规范 UTC ISO 时间 `completedAt`；
- 完整原始 `receipt`；
- 64 位小写十六进制 `seed`；
- 规范化后的有序 `students` 和 `papers`；
- 第 8 节的完整零基 `plan`；
- `planDigest`。

独立验证器必须要求分别提供事前凭证和最终报告，并依次：

1. 严格检查格式、版本、字段白名单、长度和类型；
2. 确认外部凭证和报告内凭证逐字段相同；
3. 重算输入规范形及 `inputDigest`；
4. 检查人数和固定规则字段；
5. 用报告 seed 重算 commitment；
6. 从两个域分离随机流重放提问人排程和报告人匹配；
7. 重算计划编码和 `planDigest`，逐项比较重放计划与报告计划；
8. 独立检查：论文覆盖一次、周结构正确、同周 9 位提问人不同、每人提问 3 次、报告人是全排列、报告人与本篇提问人不重合；
9. 明确显示每项结果和完整重放计划。

只验证报告自带的凭证不能证明它事先存在；必须与学生在揭晓前另行保存的凭证交叉比较。导入 JSON 一律视为不可信数据，应限制大小、数组长度和下标，并安全转义显示内容。

## 11. 公开前挑种子与更强流程

本地按钮和承诺流程不能从密码学上阻止控制设备的人在公开前反复生成候选 seed。最低操作要求是：第一次揭晓前将凭证发到外部渠道；任何重新生成都产生全新 seed 和凭证，旧记录保留在历史中。

若还要抵御单方挑种子，需要在事先承诺组织者私密量后，引入组织者无法提前预测或单方控制的公开随机贡献，再用带域分离的 SHA-256 合成最终 seed。贡献来源、截止时间、顺序及拒绝披露规则必须在抽签前约定。基础 v5 不声称提供这项更强保证。

## 12. 本地存储、备份和隐私

未完成时，seed 与完整预排计划都能暴露未来结果，必须视为秘密。三类文件必须区分：

- 公开承诺凭证：无 seed、姓名和未来计划，可在揭晓前公开；
- 私有完整备份：含姓名、seed、未揭晓计划和历史，只能放在可信位置；
- 最终审计报告：含实名输入、seed 和完整计划，只在全部完成后向合适的班级范围分享。

GitHub Pages 的 `localStorage` 按 origin 而不是路径隔离；同一 `zjwulbx.github.io` origin 下的其他页面理论上可以读取这些本地数据。页面不应加载第三方分析脚本；长期保存未公开结果时，建议使用受控设备、独立域名或妥善保管的私有备份。

## 13. 兼容与迁移

- v1–v3 没有完整 seed、版本化算法和事前承诺，只能标为旧版不可重放；
- v4 凭证、报告和私有安排必须继续由冻结的 v4 实现验证；v4 只含提问人，不能事后添加未被原承诺锁定的报告人；
- v5 使用新的存储 key。读取旧数据后可复制为新容器，但不得删除或改写旧 key；迁移失败时必须停止覆盖；
- 私有备份导入后，必须从相应版本的 seed 和规范输入重算承诺与完整计划，不能信任备份携带的计划；
- 同一逻辑抽签在多个标签页或设备上分叉时，只能在所有已揭晓结果都与同一重放计划一致的前提下合并揭晓进度。

## 14. 最低验收清单

发布实现至少应满足：

- 没有 Web Crypto 时生成失败，代码中不存在 `Math.random()` 回退；
- v5 固定向量在生产实现与独立实现中逐字节一致；
- 对多个 `N` 和至少 10,000 个固定 seed 交叉重放，提问与报告全部不变量成立；
- 更改 seed、输入顺序、角色下标、算法标识、时间或摘要任一项，验证失败；
- 报告人匹配使用独立随机流；重试次数不影响提问人计划；
- 未确认承诺时不能揭晓，未完成时不能导出最终报告；
- 公开凭证自动确认不含 seed、姓名、论文标题或计划；
- 验证器拒绝混用 v4/v5 文件，并保留 v4 固定向量；
- 超大 JSON、坏十六进制、未知字段、越界下标、原型键和 HTML 名称都安全失败或安全显示；
- v1–v4 迁移中断不会覆盖原数据，重复迁移不会制造重复历史。

## 15. v5 固定测试向量

学生依次为 `学生1` 至 `学生9`，论文依次为 `论文1` 至 `论文9`；数组按数字升序。其他输入：

```text
seed     = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
issuedAt = 2026-01-02T03:04:05.678Z
```

预期值：

```text
inputDigest = 78dd869a9a7877654d775ee55be603fd42fce918cc383b38ba2181c00da0e797
commitment  = 52cb054d505b1c4926234a0800f3027277bc5f5b3dc8b05ceae7064b9aa293ff
planDigest  = 56c4c51452aacd566e6f8ba1f69db2046af9076aa1e9441826b970bc437ebc1a
questions 流前四个 U32 = 2057970536, 1889911843, 1050146633, 450919913
presenters 流前四个 U32 = 3865904066, 2807744475, 773126469, 2778001887
```

完整计划：

```json
{
  "weeks": [
    {"weekIndex": 0, "assignments": [
      {"paperIndex": 0, "studentIndexes": [5, 4, 8], "presenterIndex": 7},
      {"paperIndex": 1, "studentIndexes": [6, 0, 3], "presenterIndex": 2},
      {"paperIndex": 2, "studentIndexes": [1, 7, 2], "presenterIndex": 3}
    ]},
    {"weekIndex": 1, "assignments": [
      {"paperIndex": 3, "studentIndexes": [1, 8, 7], "presenterIndex": 5},
      {"paperIndex": 4, "studentIndexes": [0, 4, 2], "presenterIndex": 6},
      {"paperIndex": 5, "studentIndexes": [3, 5, 6], "presenterIndex": 0}
    ]},
    {"weekIndex": 2, "assignments": [
      {"paperIndex": 6, "studentIndexes": [0, 4, 8], "presenterIndex": 1},
      {"paperIndex": 7, "studentIndexes": [5, 3, 2], "presenterIndex": 8},
      {"paperIndex": 8, "studentIndexes": [1, 7, 6], "presenterIndex": 4}
    ]}
  ]
}
```

## 16. v4 冻结兼容向量

v4 的完整定义见 [ALGORITHM-v4.md](ALGORITHM-v4.md)。学生、论文依次为 `学生1..学生12`、`论文1..论文12`，seed 全零，`issuedAt = 2026-09-09T00:00:00.000Z` 时，必须继续得到：

```text
inputDigest = c405489f4ec183129f2cde38e2807d80b59cf41631db27e152b0a565ea9e551b
commitment  = a7742f176fd52f6fc25d27d43d551fe55b2f5001af489ea5882429fccde5f61b
planDigest  = 93f49494657ed4e2bd29578f96535488638f7b31df5dd98d5ee131ede04f1394
```
