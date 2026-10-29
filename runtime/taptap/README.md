# TapTap H5云存档共享运行时

客户端使用宿主全局`tap`，没有SDK安装和跨仓库运行时导入。将`cloud-save.ts`复制到各游戏的`src/`中，登记源commit与SHA256；不要自行修改envelope、命名、校验或冲突策略。真实后台/宿主由发行任务单独验收，本目录的故障测试不是平台成功证明。

## 固定接口

```ts
createCloudSaveController({
  appId,                 // 已核验的本应用ID，字符串
  schema: 1,             // 云bundle协议schema；各原始存档仍由validate检查
  keys: [{key: PRIMARY, required: true}, {key: ACTIVE_RUN}],
  storage: rawStorage,   // 原始Storage port；不是会把坏档改成默认档的游戏读取器
  validate(raw),         // Record<string,string|null>，只检查，不改写/规范化
  describe(raw),         // 给玩家看的简短进度摘要，不含账号/令牌
  readBlocked(),         // 本地读取、schema或未保存写入保护；true时不能上传
  localRevision(),       // 有内存/待写队列的游戏必须提供：每次接受进度变动递增
  lockWrites(),          // 取消旧pending队列，阻断全部游戏存档写；返回解除锁函数
  accountToken(),        // 登录会话epoch；未登录null，成功登录/切号须变化
  reload(),             // 成功整份恢复后reload，不能只setState继续旧App
});
```

控制器：`getState()`、`subscribe(listener)`、`backup()`、`listBackups()`、`restore(uuid,{confirm:true})`、`setAutoEnabled(bool)`、`notifyLocalSaved()`、`invalidateAccount()`、`destroy()`。异步动作返回`{ok:true,uuid?}`或`{ok:false,code}`；不可从按钮出现/回调面板弹出推断保存成功。`notifyLocalSaved`只在游戏本地写确认成功后调用，不能把内存更新冒充落盘成功。

设置UI可在现有容器挂`mountCloudControls(container,controller)`，卸载调用其返回函数。它显示本地/云最后确认时间、失败重试入口、列表与二次整份恢复确认；默认不自动备份或恢复。挂载后按各游戏字体管线重建中文子集。

## 启动与写屏障（必须）

在任何game store load之前同步调用：

```ts
const recovered = recoverCloudJournal({appId, schema:1, keys, storage:rawStorage, validate});
// recovered.status === 'blocked'：禁止后续game write，显示恢复/重试状态；不能返回默认档再保存。
```

`recoverCloudJournal`最小接受appId/keys/storage；**正式适配必须也传schema与validate**，拒绝未知协议或已提交但不合法的after数据。`hasCloudJournal(storage,appId)`遇读取失败保守返回true，可作为所有游戏写入口的附加门禁。复制代码前不得遗漏启动恢复。

游戏现有读取器必须独立保护读取失败、坏JSON、未知本地schema，不把fresh/default写回原位置；云core不替代这一责任。validate检查每个required主key、允许的旧schema/字段与activeRun；optional key缺失使用null。禁止包含Token、账号凭据、诊断、恢复备份、云元数据或其他应用key。

传给core的storage必须是原始port：core持锁时需要写journal及整份替换。普通游戏写入口则检查自己的`writeLocked`/读取保护和`hasCloudJournal`；恢复开始先清掉pending重试计时器。锁回调必须覆盖该游戏全部主存档/activeRun/奖励落盘路径，不能只锁一个Settings组件。读取/写入保护与锁状态下应阻止继续产生可能无法持久化的经济动作。

`localRevision`必须包含接受的内存进度变化，即使那次localStorage写失败；仅比较磁盘原文不能识别未落盘变动。锁的队列管理本身不要递增这个进度token。恢复成功后core故意不解锁，等reload丢弃旧App内存；若reload失败，仍保持锁并显示需要重载。

## 云策略

- 上传只读取白名单原始字符串，required主key不存在、readBlocked、游戏校验失败或SHA256能力缺失都拒绝。保留原始字符串，不按字段取max或加法。
- envelope含format/appId/schema/deviceId/revision/savedAt/payload与SHA256；文件写成功后才createArchive，创建独立device/revision不可变快照，再从云端下载、读取、验证匹配后才确认。没有updateArchive覆盖共享slot。
- 每次原生调用独立once/timeout；抛出、重复和晚回调不会完成另一请求。下载用独立随机文件路径，防超时的原生文件写迟到污染下一次读取。
- 至少75秒上传间隔，跨页面保留lastAttempt；并发备份合并成一个动作，变动只记dirty、下次取最新原文。失败停止auto并留手动重试，不在失败时高频循环。
- auto每次启动都默认关。只有玩家先验证过一个云anchor，再主动开启，且该UUID仍在当前账号列表时才允许；其他设备出现新快照、切账号或账号列表丢失anchor即停止。登录成功/切号必须调用invalidateAccount并更新accountToken。不能将临时login.code当稳定身份或写进payload。
- 恢复必须先列出备份、再明确确认；下载校验后仍复核本地原文与localRevision自列表以来未变。多key before/after/phase journal先持久化再替换；部分失败尽力回滚，回滚未验证则保留journal与写锁，启动时恢复。
- 最多保留本设备最近3份已验证快照，只有新备份已确认后才清理；至少保留3份的算法满足至少2份底线。任何其他设备、未知格式、损坏/未验证对象都不删。云配额满会安全失败，不提前删除历史腾位。清理服务失败可暂时多留，不能承诺服务拒绝时仍严格只剩3份。

没有稳定账号生命周期信号时不能声称静默切账号已完全验证；宿主应验证会话事件与anchor列表的实际绑定。云和本机origin隔离、清缓存、游客切号、不同App ID均需单独验收。

## 针对性故障验证

Node.js22或更新版本，无新增依赖：

```sh
node --experimental-strip-types --test runtime/taptap/cloud-save.test.mjs
```

测试覆盖：重复/晚回调、timeout/throw、读写失败、SHA不可用、坏JSON/未来schema、75秒限流与并发合并、FS成功前不create、云回读校验、appId/schema/checksum错误、整份恢复/部分中断/回滚失败与启动恢复、未落盘进度token、切账号、其他设备冲突、清理边界与配额满。所有数据是脱敏合成fixture，未调用真实TapTap服务。
