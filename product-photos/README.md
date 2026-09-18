# 产品照片放这里

扫码落地页（`verify.html`）会自动读取本目录下的图片。**照片没准备好之前，页面照常工作** —— 会显示 emoji 占位，不会出现空白灰框。

## 文件名必须完全一致

| 产品 | 文件名 | 对应 NFC 产品码 |
|---|---|---|
| VagiBalance™ 凝胶 (3ml) | `vagi-balance.jpg` | `nb-vb-3ml-gel` |
| ProstaBalance™ (60片) | `prosta-balance.jpg` | `nb-pb-60-tab` |

## 拍摄与导出建议

- **正方形构图**，页面按 96×96 圆角裁切显示（`object-cover`，会居中裁掉多余部分）
- 建议导出 **600×600 px**，足够 2 倍屏清晰，又不拖慢手机加载
- **白底或浅色底**最稳，页面卡片是浅灰白配色
- 单张控制在 **150 KB 以内**；JPEG 质量 80 左右足够
- 产品主体居中，四周留一点空隙，避免裁切时切到瓶身

## 换文件名或加新产品怎么办

改 `verify.html` 里 `productDictionary` 对应条目的 `photo` 字段即可，例如：

```js
'nb-vb-3ml-gel': {
    ...
    photo: '/product-photos/vagi-balance.jpg',   // ← 改这里
}
```

新增产品时，照着现有条目补一份，key 用数据库 `nfc_tags.product_name` 里的产品码。

## 降级逻辑（为什么不怕图片缺失）

`verify.html` 给 `<img>` 绑了 `onload` / `onerror`：

- 图片**加载成功** → 显示照片，隐藏 emoji
- 图片**不存在或加载失败** → 保持 emoji，照片元素隐藏

所以直接把文件丢进来就生效，不用改代码、不用重新部署逻辑。
