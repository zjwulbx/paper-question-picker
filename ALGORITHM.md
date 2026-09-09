# 论文报告与提问抽签 v6 算法与审计协议

本文定义 v6 的规范输入、字符串域分隔、规范 JSON、确定性随机流、提问人排程、报告人匹配、事前承诺和事后验证格式。文中的“必须”“不得”“应当”是协议要求；实现若改变任何会影响输入摘要、随机字节、计划或承诺的步骤，必须使用新的协议或算法版本号。

v4 与 v5 已冻结并继续受支持。v4 只分配提问人，完整规范见 [ALGORITHM-v4.md](ALGORITHM-v4.md)；v5 固定每周 3 篇并增加报告人，完整规范见 [ALGORITHM-v5.md](ALGORITHM-v5.md)。任何实现都不得用 v6 规则重新解释或补写旧凭证、旧报告和旧计划。

## 1. 规则与保证边界

设规范化后的学生数为 `N`。v6 输入不再是一条没有周次信息的论文列表，而是有序的 `courseWeeks`；每个元素包含一个周标题和该周有效论文：

```json
{
  "label": "第 1 周",
  "papers": ["论文 A", "论文 B", "论文 C", "论文 D"]
}
```

完整计划必须满足：

- 每周恰好有 3 或 4 篇有效论文，周次顺序、周标题和周内论文顺序均属于输入；
- 全部有效论文数恰好等于 `N`；
- 每篇论文有 3 位提问人，同一周所有提问人互不重复；
- 每位学生在全部课程中恰好提问 3 次；
- 每篇论文有 1 位报告人，每位学生在全部课程中恰好报告 1 篇；
- 一篇论文的报告人不得是该篇的 3 位提问人；
- 报告人可以提问其他论文，包括同一周内的其他论文。禁止的是同篇角色重合和同一学生报告多篇，不是报告角色与所有提问角色全局互斥。

学生持有第一次揭晓前另行保存的公开承诺凭证、全部结束后的最终审计报告和独立验证器时，可以重算完整计划，核对课程表、种子、提问人和报告人是否与事前承诺一致。

v6 能证明的是：一份已经公开并由参与者保存的承诺，在公开之后没有被换成另一份规范输入、随机种子或完整计划。它单独不能证明：

- `issuedAt` 对应真实可信的外部时间；它只是运行设备自报的 UTC 时间；
- 组织者在公开凭证前没有反复生成并挑选候选种子；
- 网页、验证器、浏览器、操作系统或公开源代码没有被替换；
- 课堂上曾展示的画面与最终报告完全相同。

因此，第一次揭晓前必须把完整公开承诺 JSON 发到班级群、邮件等带外部时间记录的渠道。参与者也应保存自己看到的结果，并在课程结束后与重放计划逐项核对。

## 2. 固定标识与字符串散列

v6 使用以下精确 ASCII 标识：

```text
PROTOCOL_ID      = paper-question-picker/v6
NORMALIZATION_ID = nfc-course-table/v2
RNG_ID           = sha256-ctr-split-hex-u64be-u32be-reject/v3
SCHEDULE_ID      = variable-week-min-count-plus-uniform-presenter-matching/v1
```

域分隔字符串如下；每个末尾的 `\0` 表示一个实际的 `U+0000` 字符，其 UTF-8 编码为单字节 `0x00`：

```text
D_INPUT               = "paper-question-picker/input/v6\0"
D_COMMIT              = "paper-question-picker/commitment/v6\0"
D_QUESTION_RNG_KEY    = "paper-question-picker/rng-key/questions/v6\0"
D_QUESTION_RNG_BLOCK  = "paper-question-picker/rng-block/questions/v6\0"
D_PRESENTER_RNG_KEY   = "paper-question-picker/rng-key/presenters/v6\0"
D_PRESENTER_RNG_BLOCK = "paper-question-picker/rng-block/presenters/v6\0"
D_PLAN                = "paper-question-picker/plan/v6\0"
```

定义：

```text
HASH_TEXT(s) = lowercase_hex(SHA256(UTF8(s)))
```

其中 `UTF8` 无 BOM；含未配对 UTF-16 代理项的字符串必须拒绝。`HASH_TEXT` 返回 64 个小写十六进制字符。与 v4/v5 的部分二进制拼接不同，v6 公式明确对域字符串、规范 JSON、种子十六进制文本和摘要十六进制文本进行字符串连接，再统一编码为 UTF-8。实现不得把 `seedHex`、`inputDigestHex` 或 PRNG key 的十六进制文本先解码为原始字节。

## 3. 文本规范化与课程表输入

学生姓名、周标题和有效论文标题分别按以下规则规范化：

1. 值必须是字符串，且不得含 `CR` 或 `LF`；
2. 拒绝含未配对 UTF-16 代理项的字符串；
3. 执行 Unicode NFC；
4. 删除首尾属于以下固定集合的字符：`U+0009..U+000D`、`U+0020`、`U+00A0`、`U+1680`、`U+2000..U+200A`、`U+2028`、`U+2029`、`U+202F`、`U+205F`、`U+3000`、`U+FEFF`；
5. 结果不得为空，且每项 UTF-8 长度不得超过 4096 字节；
6. 不改变字符串内部空白、大小写或标点。

调用审计核心的输入必须是：

```json
{
  "students": ["学生 1", "学生 2"],
  "courseWeeks": [
    {"label": "第 1 周", "papers": ["论文 1", "论文 2", "论文 3"]}
  ]
}
```

并满足：

- `students` 和 `courseWeeks` 都是数组；
- `9 <= students.length <= 10000`；
- 学生姓名规范化后全局唯一；
- `1 <= courseWeeks.length <= 10000`，每周对象只允许 `label`、`papers` 两个字段；
- 周标题规范化后全局唯一；
- 每周 `papers.length` 严格等于 3 或 4；
- 所有有效论文标题规范化后全局唯一；
- 全部 `papers.length` 之和严格等于学生数 `N`；
- `3 × max(papers.length) <= N`，从而本周所需提问人可以全部不同；
- 下节定义的规范输入 JSON 的 UTF-8 长度不超过 8 MiB。

协议不要求 `N` 是 3 的倍数。若包含 4 篇论文的周次，则上述同周不重复约束自然要求 `N >= 12`。

网页可接受三列 Tab 分隔的课程表，列含义为“周次/日期、论文标题、状态”。状态为空、`正常` 或 `有效` 的行会进入 `courseWeeks`；状态为 `取消` 的行会在调用审计核心前被排除。原始 Tab、状态文字、取消行和原始行号不属于协议输入，只有规范化后的有序 `courseWeeks` 被承诺。

## 4. 规范 JSON

v6 的散列依赖协议定义的规范对象和 ECMAScript `JSON.stringify` 结果。验证器先检查来件 JSON 的字段白名单、类型和约束，再按本节给出的键序重建新的规范对象，最后散列。因此，导入文件的缩进、键间空白和对象键的原始排列都不影响验证；数组顺序仍然是协议数据。本文将规范对象的序列化结果记为 `JSON_V6(value)`：

- UTF-8 编码前不含 BOM、缩进、换行或键间空格；
- 数组顺序原样保留；
- 字符串按 ECMAScript `JSON.stringify` 转义；
- 本协议中的整数均为有限、非负十进制整数；
- 来件对象不得缺少或加入额外字段；来件键序不受限制；
- 进入散列的新对象必须按本文列出的键序重建，不对键做字母排序。

规范输入对象的键顺序固定为：

```text
students, courseWeeks
```

每个周对象的键顺序固定为：

```text
label, papers
```

因此：

```text
CANONICAL_INPUT_JSON = JSON_V6({students: [...], courseWeeks: [...]})
inputDigestHex       = HASH_TEXT(D_INPUT || CANONICAL_INPUT_JSON)
```

学生顺序、周次顺序、周标题、周内论文顺序或任何规范化文本的变化都会改变输入摘要。

## 5. 随机种子与两条独立随机流

新建抽签必须使用 Web Crypto 取得恰好 32 个随机字节，并写为 64 位小写十六进制 `seedHex`：

```js
crypto.getRandomValues(new Uint8Array(32))
```

若安全随机源不可用，必须停止；不得退回 `Math.random()`、时间戳或 UUID。调用确定性重放接口时，外部提供的 seed 也必须严格符合相同的 64 位小写十六进制格式。

提问人与报告人共用一个 seed，但使用两个域分离的随机流。对用途 `role`：

```text
role = questions:
    KEY_DOMAIN   = D_QUESTION_RNG_KEY
    BLOCK_DOMAIN = D_QUESTION_RNG_BLOCK

role = presenters:
    KEY_DOMAIN   = D_PRESENTER_RNG_KEY
    BLOCK_DOMAIN = D_PRESENTER_RNG_BLOCK

keyHex = HASH_TEXT(KEY_DOMAIN || seedHex || inputDigestHex)
```

每条流独立维护无符号 64 位 counter，初值为 0。把 counter 写成 16 个小写十六进制字符，高 32 位在前、低 32 位在后，每半段都左补零至 8 位：

```text
counterHex = HEX8(counterHigh) || HEX8(counterLow)
blockHex   = HASH_TEXT(BLOCK_DOMAIN || keyHex || counterHex)
block      = 将 blockHex 每两个十六进制字符解码为一个字节
```

随机字节流为 `block(0) || block(1) || ...`。每生成一块，低 32 位加一并向高 32 位进位；counter 超过 `2^64-1` 时必须停止。`nextUint32()` 连续读取 4 个随机字节，并按无符号大端整数解释。

独立随机流保证报告人匹配尝试次数不会改变提问人安排。

## 6. 无偏整数与洗牌

`uniform(n)` 返回 `0..n-1` 的无偏整数，`n` 必须位于 `1..2^32`：

```text
limit = floor(2^32 / n) * n
循环：
    x = nextUint32()
    若 x >= limit：丢弃并继续
    否则返回 x mod n
```

`shuffle(A)` 必须复制输入，并执行逆向 Fisher–Yates：

```text
for i = A.length - 1 down to 1:
    j = uniform(i + 1)
    swap A[i], A[j]
return A
```

长度 0 或 1 的数组不消耗随机字节。

## 7. 提问人排程

只使用 `questions` 随机流。论文按 `courseWeeks` 及每周 `papers` 的输入顺序取得连续的全局零基 `paperIndex`：

```text
counts = 长度 N、初值全 0
weeks = []
paperCursor = 0

for weekIndex = 0 .. courseWeeks.length-1:
    weekSize = courseWeeks[weekIndex].papers.length
    needed = 3 * weekSize
    selected = []
    levels = counts 在本周开始时的不同值，按数字升序

    for level in levels:
        candidates = 按学生下标 0..N-1 升序扫描，
                     取 counts[index] == level 的下标
        candidates = shuffle(candidates)
        从头追加到 selected，直到 candidates 用完或 selected 长度为 needed
        若 selected 长度为 needed：结束 levels 循环

    若 selected 长度不为 needed：失败
    weeklyOrder = shuffle(selected)

    for paperOffset = 0 .. weekSize-1:
        assignment = {
            paperIndex: paperCursor + paperOffset,
            studentIndexes: weeklyOrder[paperOffset*3 .. paperOffset*3+2],
            presenterIndex: null
        }

    对 selected 中每个学生执行 counts[index] += 1
    paperCursor += weekSize

结束后若 paperCursor != N 或任一 counts[index] != 3：失败
```

`levels` 是本周开始时的快照。每层候选数组即使只需取其中一部分，也必须完整洗牌；选满后还要单独洗牌 `selected`，再连续切成三人小组。不得依赖对象、集合、语言环境或 DOM 的未规定遍历顺序。

### 7.1 次数为何恰好均衡

初始所有 `counts` 都为 0。每周只从最低计数层开始选，并且每名学生在一周最多入选一次。归纳可得，每周结束时任意两名学生的累计次数之差不超过 1。全部有效论文恰好为 `N` 篇，总提问名额为 `3N`，平均值恰好为 3；因此最终所有学生都恰好提问 3 次。

同一计数层中的学生通过无偏洗牌决定是否被选，选中者又通过一次无偏洗牌决定被分到哪篇论文及组内位置。该规则对同一计数层中的学生对称，但它不是从“所有满足最终约束的完整提问计划”中做全局均匀抽样，页面和规范不得作此声称。

## 8. 报告人一对一匹配

把第 7 节得到的 assignment 按全局 `paperIndex = 0..N-1` 展平。只使用 `presenters` 随机流，最多尝试 4096 次：

```text
indexes = [0, 1, ..., N-1]

for attempt = 0 .. 4095:
    candidate = shuffle(indexes)
    // candidate[paperIndex] 是该篇论文的候选报告人
    若每个 paperIndex 都满足：
        candidate[paperIndex] 不在该篇 studentIndexes 中
    则接受 candidate 并停止

若 4096 次均未接受：失败，不创建抽签或承诺
```

接受的 candidate 是全排列，因此每篇恰有 1 位报告人，每位学生恰好报告 1 篇。报告人只需避开本篇 3 位提问人；其在其他论文中担任提问人是允许的。

### 8.1 存在性、均匀性和重试上限

把论文和学生看成二分图。每篇论文禁止它自己的 3 位提问人；每名学生最终也恰好提问 3 篇。因此允许边构成一个 `(N-3)` 正则二分图。正则二分图满足 Hall 条件，所以至少存在一个覆盖全部论文和学生的完美匹配。

若 SHA-256 流视为理想均匀随机源，每次 Fisher–Yates 在所有 `N!` 个排列中均匀；拒绝无效排列后，成功结果在所有有效报告人匹配中均匀。由 van der Waerden 下界，每次成功概率至少为 `((N-3)/N)^N`。允许的最小规模 `N=9` 时不低于 `(2/3)^9 ≈ 2.60%`，4096 次均失败的理想概率小于 `2×10^-47`；对 `N=48`，下界约为 `4.5146%`，4096 次均失败的上界约为 `6.63×10^-83`。

4096 是随机搜索的安全上限。真的触及上限时必须停止，不能切换到确定性或有偏的后备匹配算法。

## 9. 计划结构与计划摘要

计划的规范序列化键序是协议的一部分；来件 JSON 对象的键序不是。验证器先严格检查计划字段和不变量，再构造 `canonicalPlan(plan)`。完整结构为：

```json
{
  "weeks": [
    {
      "weekIndex": 0,
      "assignments": [
        {
          "paperIndex": 0,
          "studentIndexes": [1, 2, 3],
          "presenterIndex": 4
        }
      ]
    }
  ]
}
```

固定键顺序分别为：

```text
plan:       weeks
week:       weekIndex, assignments
assignment: paperIndex, studentIndexes, presenterIndex
```

每周 assignment 数必须等于对应 `courseWeeks[weekIndex].papers.length`；每个 `studentIndexes` 必须恰有 3 个合法下标；全局论文下标必须按输入顺序从 0 连续到 `N-1`。计划还必须独立通过同周不重复、每人提问 3 次、报告人全排列和同篇角色不重合检查。

```text
CANONICAL_PLAN_JSON = JSON_V6(canonicalPlan(plan))
planDigestHex       = HASH_TEXT(D_PLAN || CANONICAL_PLAN_JSON)
```

周标题和论文标题不直接重复写入计划，但已由 `inputDigestHex` 锁定。揭晓状态、当前周、动画和操作日志不属于计划，也不影响 `planDigestHex`。

## 10. 私密运行安排

网页保存的运行安排使用学生编号 `student-1` 至 `student-N`，每周包含：

```json
{
  "id": "week-1",
  "label": "第 1 周",
  "assignments": [
    {
      "paper": "论文标题",
      "studentIds": ["student-2", "student-3", "student-4"],
      "presenterId": "student-5"
    }
  ],
  "revealed": [false, false, false]
}
```

`revealed.length` 必须等于该周 assignment 数。私密 `audit` 元数据含协议标识、签发时间、输入摘要、承诺、计划摘要、seed 和可为空的承诺确认时间。恢复私密备份时必须从 seed 和规范输入重放计划；不能仅相信备份中携带的可见 assignment。

## 11. 公开承诺凭证

承诺上下文对象必须按以下键顺序构造：

```json
{
  "protocolId": "paper-question-picker/v6",
  "normalizationId": "nfc-course-table/v2",
  "rngId": "sha256-ctr-split-hex-u64be-u32be-reject/v3",
  "scheduleId": "variable-week-min-count-plus-uniform-presenter-matching/v1",
  "issuedAt": "规范 UTC ISO 8601 时间",
  "studentCount": 48,
  "paperCount": 48,
  "weekCount": 13,
  "weekPaperCounts": [4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3],
  "studentsPerPaper": 3,
  "finalSelectionsPerStudent": 3,
  "presentersPerPaper": 1,
  "finalPresentationsPerStudent": 1
}
```

`issuedAt` 必须严格为 `YYYY-MM-DDTHH:mm:ss.sssZ`。`weekPaperCounts` 按周次顺序列出每周有效论文数，长度必须等于 `weekCount`，每项只能是 3 或 4，总和必须等于 `paperCount`。

承诺公式为：

```text
CONTEXT_JSON = JSON_V6(context)
commitment   = HASH_TEXT(
    D_COMMIT
 || CONTEXT_JSON
 || inputDigestHex
 || seedHex
)
```

公开凭证必须精确包含以下字段。下列顺序是生成器的规范输出顺序；导入文件的对象键可以是其他顺序：

```json
{
  "format": "paper-question-picker-commitment",
  "version": 6,
  "protocolId": "paper-question-picker/v6",
  "normalizationId": "nfc-course-table/v2",
  "rngId": "sha256-ctr-split-hex-u64be-u32be-reject/v3",
  "scheduleId": "variable-week-min-count-plus-uniform-presenter-matching/v1",
  "issuedAt": "规范 UTC ISO 8601 时间",
  "studentCount": 48,
  "paperCount": 48,
  "weekCount": 13,
  "weekPaperCounts": [4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3],
  "studentsPerPaper": 3,
  "finalSelectionsPerStudent": 3,
  "presentersPerPaper": 1,
  "finalPresentationsPerStudent": 1,
  "inputDigest": "64 位小写十六进制",
  "commitment": "64 位小写十六进制"
}
```

不允许缺失字段或额外字段。公开凭证不得包含 seed、学生姓名、周标题、论文标题、计划、随机状态或未来结果。`inputDigest` 是未加盐摘要，不等于匿名化；知道候选输入的人仍可能离线验证猜测。人工核对应比较完整 64 位 commitment，短码只能辅助辨认。

## 12. 最终审计报告

最终报告只能在用户已经确认公开承诺且所有论文均已揭晓后生成。它必须精确包含以下字段。下列顺序是生成器的规范输出顺序；导入文件的对象键可以是其他顺序：

```json
{
  "format": "paper-question-picker-final-audit",
  "version": 6,
  "completedAt": "规范 UTC ISO 8601 时间",
  "receipt": {},
  "seed": "64 位小写十六进制",
  "students": [],
  "courseWeeks": [],
  "plan": {},
  "planDigest": "64 位小写十六进制"
}
```

其中：

- `receipt` 是第 11 节的完整公开凭证；
- `students` 与 `courseWeeks` 是规范化后的实名有序输入；
- `courseWeeks` 的每周篇数必须与 receipt 的 `weekPaperCounts` 逐项一致；
- `plan` 是第 9 节的完整零基计划；
- `completedAt` 不得早于承诺签发时间，生成端还要求其不早于承诺确认时间。

最终报告含姓名、论文、seed 和全部未来安排，只应在课程全部结束后、在合适的班级范围内分享。

## 13. 验证顺序

独立验证器必须要求分别提供事前公开保存的 receipt 和课程结束后的 report，并依次：

1. 严格检查两份文件的格式、版本、字段白名单、类型、长度、规范时间和十六进制格式；
2. 逐字段确认外部 receipt 与 report 内嵌 receipt 一致，其中 `weekPaperCounts` 按数组顺序逐项比较；
3. 规范化 `students` 和有序 `courseWeeks`，检查每周 3/4 篇、论文总数、唯一性和容量条件；
4. 确认 receipt 的人数、周数和 `weekPaperCounts` 与规范输入一致；
5. 重算 `inputDigestHex`；
6. 用 report 中的 `seedHex` 重算 commitment；
7. 从两条域分离随机流重放提问人排程和报告人匹配；
8. 严格检查 report 中计划的结构与所有角色不变量；
9. 重算报告计划和重放计划各自的 `planDigestHex`，同时比较规范计划 JSON；
10. 展示完整重放计划，供参与者与课堂截图或记录逐项核对。

只验证 report 自带的 receipt 不能证明它事先存在；必须与参与者在第一次揭晓前另行保存的外部 receipt 交叉比较。

导入 JSON 一律视为不可信数据。实现应限制文件大小、数组长度和下标，拒绝额外字段，并通过文本节点等方式安全显示姓名和论文标题，不得把导入内容当 HTML 执行。

## 14. 公平性与密码学边界

v6 的“无偏”有明确范围：

- `uniform(n)` 通过拒绝取模消除整数取模偏差；
- Fisher–Yates 在理想随机字节模型下给出均匀排列；
- 同一累计次数层中的学生被对称处理；
- 已选学生在当周论文与组内位置之间均匀洗牌；
- 报告人成功结果在全部有效一一匹配中均匀。

v6 不声称提问计划在所有满足约束的完整计划中全局均匀。最低次数优先是一项公开、确定且可重放的平衡策略，它有意限制计划分布来保证任意前缀中的累计次数尽量接近。

基础 v6 也不能阻止掌握设备的人在公开前反复生成不同 seed 并挑选结果。若要抵御单方挑种子，需要事先承诺组织者私密量，再引入组织者无法提前预测或单方控制的外部随机贡献，并提前约定贡献顺序、截止时间和拒绝披露规则；这属于更强的多方随机流程，不是基础 v6 的默认保证。

## 15. 存储、备份与隐私

未完成时，seed 与完整预排计划会暴露未来结果，必须视为秘密。三类文件必须清楚区分：

- 公开承诺凭证：无 seed、姓名、周标题、论文标题和计划，可在抽签前公开；
- 私密完整备份：含姓名、课程表、seed、未揭晓计划、进度和历史，只能放在可信位置；
- 最终审计报告：含实名输入、seed 和完整计划，只在课程完成后向合适范围分享。

浏览器 `localStorage` 按 origin 而不是路径隔离。同一 `zjwulbx.github.io` origin 下的其他页面理论上可以读取这些本地数据。页面不应加载第三方分析脚本；长期保存未公开结果时，建议使用受控设备、独立域名或妥善保管的私密备份。

## 16. 版本兼容与迁移

- v1–v3 没有完整 seed、版本化算法和事前承诺，只能作为旧进度查看或恢复，不能补造成可重放记录；
- v4 必须继续由冻结的 v4 实现验证，只含提问人，不能事后添加报告人；
- v5 必须继续由冻结的 v5 实现验证，固定每周 3 篇；不能按 v6 的 `courseWeeks` 重新分周；
- v6 加载 v5 核心作为旧协议实现，并只对 `version = 6`、`protocolId = paper-question-picker/v6` 的对象使用本规范；
- v6 使用新的本地存储 key。正常可读的旧记录可复制到新容器，但不得删除或改写旧 key；若旧值无法解析，必须先将它的完整原始文本写入独立隔离 key，确认写入成功后才可移除那个仍未被其他标签页改变的无法读取值；任一保全或迁移步骤失败时必须停止覆盖；
- 私密备份导入后，必须按记录自身的协议版本重算摘要、承诺和计划；
- 同一逻辑抽签在多个标签页或设备上分叉时，只有在不可变计划相同且每个已揭晓结果都与重放计划一致时，才可合并揭晓进度。

## 17. v6 合成固定向量

以下向量用于跨实现核对。所有文本均已是 NFC，下标从 0 开始：

- `students[j] = "匿名学生" + (j + 1 的 3 位十进制表示)`，`0 <= j < 48`；
- `weekPaperCounts = [4,4,4,4,4,4,4,4,4,3,3,3,3]`；
- `courseWeeks[i].label = "第" + (i + 1 的 2 位十进制表示) + "周"`，`0 <= i < 13`；
- 按周、按周内顺序依次填入 `论文001` 至 `论文048`，每周数量由 `weekPaperCounts[i]` 决定；
- `seedHex = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`；
- `issuedAt = 2026-09-09T00:00:00.000Z`。

期望结果：

```text
inputDigest = c165a249c1958ac1c4090ba51ce0450580770043ffc7b244d5b502688298a7f7
commitment  = 72c68bf7828b87d0c5496f055cb568f20c5ad321d3d957cb33c13f2b5b7aa925
planDigest  = 3a57d448814144a6e29d005702e0ac40ee66e4f0b415233059c43600d4260eef

questions 流前 4 个 u32  = [757285734, 3441923874, 3892782815, 3875097610]
presenters 流前 4 个 u32 = [2817210796, 3416166768, 264532386, 2533968787]
```

这 8 个 `u32` 是刚建对应随机流、尚未调用 `uniform`、`shuffle`或排程函数时，连续读取的值。新实现应同时核对输入摘要、承诺、两条随机流、完整计划及计划摘要；只匹配最终一个摘要不足以定位偏差。

## 18. 最低验收清单

发布实现至少应满足：

- 没有 Web Crypto 时新建抽签失败，代码中不存在 `Math.random()` 后备随机源；
- v6 生产实现与独立参考实现对固定向量逐字符、逐随机字节和逐计划一致；
- 对多种 3/4 周次组合、不同周次顺序和大量固定 seed 交叉重放，所有提问与报告不变量成立；
- 交换学生、周次、周标题或论文顺序会改变输入摘要；
- 更改 seed、输入、分周结构、角色下标、协议标识、时间、摘要或计划任一项会导致验证失败；
- 报告人匹配使用独立随机流，重试次数不改变提问人计划；
- 未确认公开承诺时不能揭晓，未完成全部论文时不能导出最终报告；
- 公开凭证自动检查不含 seed、姓名、周标题、论文标题或计划；
- 验证器拒绝混用 v4/v5/v6 文件并保留 v4、v5 冻结向量；
- 超大 JSON、坏十六进制、未知字段、越界下标、重复角色、原型键和 HTML 文本都安全失败或安全显示；
- v1–v5 迁移中断不会覆盖旧数据，重复迁移不会制造重复历史。

一旦发布过 v6 receipt，本文件、实现、域字符串、规范 JSON 键顺序和随机消费顺序都必须冻结。任何影响这些结果的修订都必须发布为新协议版本。
