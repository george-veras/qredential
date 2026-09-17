<!-- translated-from: 48cad2b0114eb74e -->
<!-- section: statement -->

<!-- eyebrow -->
*无障碍*

# 用 WCAG 2.2 AA 量这个站点

<!-- lede -->
本站每一页都以符合 [WCAG 2.2](https://www.w3.org/TR/WCAG22/) AA 级为目标。这一页说明这个说法依据
什么，以及不依据什么。

<!-- section: scope -->

## 这个说法覆盖什么

本站三十六个页面的全部，九种语言的全部：首页、文档、演练场和这份声明。浅色和深色两套主题。最近一次评估在
2026 年 9 月 17 日，针对当天发布的版本。

[![AA 级符合性，W3C WAI 网页内容无障碍指南 2.2](https://qredential.js.org/wcag2.2AA.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/conformance-logos/)

上面的徽标是自我声明。W3C 只是公开它供任何人使用，并不审核或验证任何据此做出的说法，这正是本页其余
部分存在的原因。

<!-- section: method -->

## 是怎么评估的

四种方式，都可以重复，并且每次改动都会由持续集成再跑一遍：

- **规则引擎。** 用 `axe-core` 跑了三十九次页面加载，覆盖九种语言的三十六个页面，外加每种形态各一页的
  深色主题，检查对应 WCAG 2.2 A 级和 AA 级的标签。
- **规则引擎看不见的准则。** 用刻意操控的浏览器验证：把页面回流到 320 CSS 像素、把文字放大到
  200%、套用标准规定的文字间距覆盖、比较获得焦点前后的焦点指示、确认获得焦点的控件没有被别的东西盖住、
  把每个指针目标与 24 乘 24 的最小值对照、确认每个控件都有可访问的名称。
- **键盘。** 确认跳转链接是每一页上键盘最先到达的元素，并且使用它会把焦点真正移入正文，而不只是滚动
  页面。
- **手工逐条。** WCAG 2.2 A 级和 AA 级的五十五条成功准则全部，每一条都记下判定和依据，写在
  [ACCESSIBILITY.md](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md) 里。

<!-- section: limits -->

## 这个说法不覆盖什么

直说，因为一份合规声明的价值，正好等于它的边界的价值：

- **没有用辅助技术测试过。** 没有使用屏幕阅读器，也没有残障人士试用过本站。结构是通过查看无障碍树
  确认的，那和真正听一遍不是一回事。
- **没有第三方审计。** 没有任何独立的人核对过这些，就像没有任何独立的人审计过这个库的密码学实现一样。
- 自动化测试大约覆盖 WCAG 要求的三分之一。上面另外三种方式正是因此存在，但它们仍然代替不了一个真正
  依赖它的人。

<!-- section: known -->

## 已知的限制

- **二维码是数据的图像。** 没有辅助技术能读懂它，也不该需要读懂：旁边的说明给出了版本和字符数，它编码
  的每一个值都在同一页上以文字印出。
- **演练场需要 JavaScript**，因为它要在读者自己的浏览器里跑这个库，这正是它存在的意义。文档和首页
  不需要：它们的内容就在 HTML 里。

<!-- section: report -->

## 如果你发现了问题

有人告诉我们，是这件事变好的唯一途径。到
[github.com/george-veras/qredential/issues](https://github.com/george-veras/qredential/issues) 开一个 issue，或者用任何你觉得方便的
方式说一声。描述发生了什么就够了；能指出是哪一条成功准则当然很好，但从来不是必须的。

<!-- cta --> [报告无障碍问题](https://github.com/george-veras/qredential/issues/new)
<!-- cta --> [阅读完整评估](https://github.com/george-veras/qredential/blob/main/ACCESSIBILITY.md)
