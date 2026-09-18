# NovaBalance 收款开通指南

代码已经写完并通过校验，**但站点现在还收不到钱** —— 缺的是 Stripe 账号和两个密钥。
照着下面做，先在测试模式跑通，再切真实收款。

> ⚠️ **密钥绝对不要贴进聊天、不要写进代码、不要提交到 Git。**
> 只填进 Netlify 的环境变量界面，那里输入是掩码的。

---

## 第 0 步：确认用哪个账号（重要）

用 **`hudsontuo@gmail.com`** 新注册。

**不要用 Escrix 那个 Stripe Atlas 账号** —— 那属于 Escrix, Inc.，是另一个法律实体。
两边资金混在一起，将来 Escrix 被收购时是笔烂账。

注册时填的实体信息要和站点页脚一致：**NovaBalance Health LLC**。

---

## 第 1 步：注册 Stripe

1. 打开 https://dashboard.stripe.com/register
2. 邮箱用 `hudsontuo@gmail.com`
3. 国家选 **United States**
4. 业务类型按你的实际情况填（LLC / 个人独资）
5. 填 EIN 或 SSN、营业地址
6. 绑定收款银行账户（你说已经有了）

> 资料审核通常几小时到 1-2 个工作日。**审核期间测试模式就能用**，不必干等。

---

## 第 2 步：拿测试密钥

在 Stripe 后台**右上角把开关切到「Test mode」**（测试模式），然后：

**Developers → API keys → Secret key → Reveal**

复制那个以 `sk_test_` 开头的值。

---

## 第 3 步：填进 Netlify 环境变量

Netlify 后台 → 你的站点 → **Site configuration → Environment variables → Add a variable**

需要四个（后两个应该已经有了，顺便核对）：

| 变量名 | 值 | 说明 |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` | 第 2 步拿到的 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | **第 4 步才会有，先跳过** |
| `SUPABASE_URL` | 已有 | NFC 验证在用 |
| `SUPABASE_SERVICE_KEY` | 已有 | NFC 验证在用 |

---

## 第 4 步：配置 Webhook

Stripe 后台（仍在 Test mode）→ **Developers → Webhooks → Add endpoint**

- **Endpoint URL**：
  ```
  https://novabalancehealth.com/.netlify/functions/stripe_webhook
  ```
- **Events to send**：只勾 **`checkout.session.completed`**
- 创建后点 **Reveal** 拿到 **Signing secret**（`whsec_` 开头）
- 把它填进 Netlify 的 `STRIPE_WEBHOOK_SECRET`

> Webhook 是订单入库的唯一来源。没配它，钱能收到但你的数据库里不会有订单记录。

---

## 第 5 步：建数据库表

Supabase 后台 → `novabalance` 项目 → **SQL Editor** → 粘贴并运行：

```
supabase/001_orders_and_subscribers.sql
```

它会建两张表并**开启 RLS**：

- `orders` —— 订单（含客户姓名、地址，仅服务端密钥可读）
- `subscribers` —— 邮箱 + 专属折扣码

还会建一个方便你人工查账的视图 `orders_readable`（金额已从「分」换算成「元」）。

---

## 第 6 步：测试下单

用 Stripe 的测试卡号，**不会产生真实扣款**：

| 场景 | 卡号 | 其他字段 |
|---|---|---|
| 支付成功 | `4242 4242 4242 4242` | 有效期填任意未来日期，CVC 任意 3 位，邮编任意 |
| 需要 3D 验证 | `4000 0025 0000 3155` | 会弹出验证框 |
| 卡被拒 | `4000 0000 0000 0002` | 用来看失败提示 |

**完整走一遍：**

1. 打开 https://novabalancehealth.com
2. 点 Buy Now → 购物车 → **Secure Checkout**
3. 应该跳转到 Stripe 托管的结账页
4. 填测试卡号和收货地址
5. 付款后应跳回 `order-success.html`
6. 回 Supabase 查：`select * from orders_readable;` —— 应该有一条记录

**顺便测折扣码：**

1. 手机扫 NFC 标签打开验证页
2. 在「获取复购 85 折优惠」处输入邮箱 → 点「领取优惠」
3. 当场会显示形如 `NB15-A7K2M9` 的码
4. 去结账页，在 **Add promotion code** 处输入它 → 总价应减 15%
5. 同一个邮箱再领一次，会返回**同一个码**（不会重复发）

---

## 第 7 步：切换到真实收款

测试全部跑通、且 Stripe 账号审核通过后：

1. Stripe 后台右上角关掉 **Test mode**
2. 重新取一次 **Secret key**（这次是 `sk_live_` 开头）
3. **重新创建一个 Webhook endpoint**（正式模式的 webhook 是独立的），拿新的 `whsec_`
4. 用这两个新值**覆盖** Netlify 里的 `STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`
5. 在 Netlify 触发一次重新部署让新变量生效
6. **用你自己的真卡下一单小额测试**，确认到账后再退款

---

## 设计说明（出问题时看这里）

### 钱的部分绝不信任浏览器
前端只发送商品 **ID 和数量**：

```json
{ "items": [{ "id": "vagibalance", "qty": 2 }] }
```

价格写死在 `netlify/functions/create_checkout_session.js` 的 `CATALOG` 里。
顾客改 JS 也只能改自己看到的数字，**实际扣款金额由服务端决定**。

**改价时必须同步四处**（见 `skills/static-site-edit-verification`）：
1. `create_checkout_session.js` 的 `CATALOG`（单位：分）
2. `products.json`
3. 商品详情页的显示价和 JSON-LD
4. `cart.js` 的 `PRODUCTS`（仅显示用）

### 零 npm 依赖
你用拖拽 zip 部署，Netlify **不会跑 `npm install`**。
所以三个函数只用 Node 内置的 `https` 和 `crypto`，直连 Stripe REST API。
**不要给函数加任何 npm 包**，否则一上线就 500。

### Webhook 安全
`stripe_webhook.js` 在解析内容前先验签：
- HMAC-SHA256 + **常量时间比较**（防时序攻击）
- **5 分钟时间窗**（防重放）
- 验签失败一律 400，不写库

已实测：无签名、伪造签名、过期签名、签名后改内容、错误密钥 —— **全部拒绝**；只有真实签名放行。

### 幂等
- 同一个 `stripe_session_id` 重复投递不会产生两条订单（数据库唯一约束 + `merge-duplicates`）
- 同一个邮箱重复领码返回原来的码，不会多发

### 运费
满 **$50** 免运费，否则 **$5.99**。改这个要同时动两处：
- `create_checkout_session.js` 的 `FREE_SHIPPING_THRESHOLD` / `FLAT_SHIPPING_AMOUNT`（单位：分）
- `cart.js` 的 `FREE_SHIPPING_THRESHOLD` / `FLAT_SHIPPING`（单位：元，仅显示）

### 折扣码
- Stripe 里有一个 **15% off** 的优惠券 `nb-refill-15`，首次调用时自动创建
- 每个邮箱生成一个**一次性**促销码，形如 `NB15-XXXXXX`
- 字母表排除了 `0/O/1/I/L`，避免顾客照着手机屏幕输错
- 结账页的优惠码输入框是 Stripe 自带的（`allow_promotion_codes`）

### 目前在售
只有 **VagiBalance $29.99** 和 **ProstaBalance $99.99**。
FemBalance 和 OvaBalance 已从首页隐藏，详情页的购买按钮换成了 **Coming Soon**，
且**不在服务端 CATALOG 里** —— 就算有人伪造请求也买不到。

将来上市时要做三件事：
1. 取消 `index.html` 里对应商品卡的注释
2. 恢复首页 `hasOfferCatalog` 结构化数据里的条目
3. **在 `CATALOG` 里加上它们**，并把详情页的 Coming Soon 换回购买按钮

---

## 还没做的事

- **邮件发送**：折扣码目前是当场显示在页面上，没有发邮件。要发邮件需要接
  Resend / SendGrid 并验证发信域名。邮箱已经存进 `subscribers` 表，随时可以做。
- **订单状态流转**：`orders.status` 目前只会是 `paid`。发货后需要人工改成
  `shipped` 并填 `fulfilled_at`，或者将来做个后台。
- **退款**：目前只能在 Stripe 后台手动操作，站点上没有入口。
- **销售税**：没有配置。美国各州规则不同，上量之后建议开 Stripe Tax。
