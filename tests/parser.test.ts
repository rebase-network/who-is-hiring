import { isLikelyHiringRichJob, issueToNormalized, issueToRich, parseIssueText } from "../src/parser.js";

describe("parseIssueText", () => {
  it("extracts enriched fields from english issues", () => {
    const parsed = parseIssueText(
      "[Remote/Singapore] ACME is hiring Senior Backend Engineer",
      [
        "Company: ACME Labs",
        "Location: Singapore",
        "Salary: 5,000-7,500 USD / month",
        "Work mode: Remote",
        "Timezone: UTC+8",
        "Employment Type: Full-time",
        "Responsibilities:",
        "- Build and maintain indexer services",
        "- Own API reliability",
        "Contact: jobs@acme.dev, Telegram @acme_hr",
      ].join("\n"),
    );

    expect(parsed.company).toBe("ACME Labs");
    expect(parsed.location).toBe("Singapore");
    expect(parsed.salary).toBe("5,000-7,500 USD / month");
    expect(parsed.salary_min).toBe(5000);
    expect(parsed.salary_max).toBe(7500);
    expect(parsed.salary_currency).toBe("USD");
    expect(parsed.salary_period).toBe("month");
    expect(parsed.remote).toBe(true);
    expect(parsed.work_mode).toBe("Remote");
    expect(parsed.timezone).toBe("UTC+8");
    expect(parsed.employment_type).toBe("Full-time");
    expect(parsed.responsibilities).toContain("Build and maintain indexer services");
    expect(parsed.contact_channels).toContain("email:jobs@acme.dev");
    expect(parsed.contact_channels).toContain("telegram:@acme_hr");
  });

  it("handles chinese headings and title fallback extraction", () => {
    const parsed = parseIssueText(
      "[上海/远程] 某公司诚聘 区块链工程师 薪水 25k-40k RMB/月",
      [
        "公司名称：星链科技",
        "办公方式：可远程",
        "时区：UTC+8",
        "雇佣类型：全职",
        "岗位职责：负责智能合约开发与链上数据服务",
        "应聘方式：微信 abc_hr 或邮箱 hr@example.cn",
      ].join("\n"),
    );

    expect(parsed.company).toBe("星链科技");
    expect(parsed.location).toBe("上海/远程");
    expect(parsed.remote).toBe(true);
    expect(parsed.salary).toContain("25k-40k RMB/月");
    expect(parsed.salary_min).toBe(25000);
    expect(parsed.salary_max).toBe(40000);
    expect(parsed.salary_currency).toBe("CNY");
    expect(parsed.salary_period).toBe("month");
    expect(parsed.timezone).toBe("UTC+8");
    expect(parsed.employment_type).toBe("全职");
    expect(parsed.responsibilities).toContain("智能合约开发");
    expect(parsed.contact_channels).toContain("wechat:abc_hr");
    expect(parsed.contact_channels).toContain("email:hr@example.cn");
  });

  it("detects onsite-only jobs and keeps remote false", () => {
    const parsed = parseIssueText(
      "[Beijing] Example Co hiring QA Engineer",
      "Work mode: onsite only\nCompensation: 30k-50k RMB",
    );

    expect(parsed.remote).toBe(false);
    expect(parsed.work_mode).toBe("onsite only");
    expect(parsed.salary_min).toBe(30000);
    expect(parsed.salary_max).toBe(50000);
    expect(parsed.salary_currency).toBe("CNY");
  });

  it("detects Chinese onsite and hybrid-like work mode phrases", () => {
    const onsite = parseIssueText(
      "[杭州] AI金融平台诚聘资深测试工程师",
      "现场办公：杭州\nTG：daisy51518",
    );
    const hybridish = parseIssueText(
      "[菲律宾] 安全维运工程师",
      "工作模式：半远端\nTG：abc",
    );

    expect(onsite.work_mode).toBe("现场办公");
    expect(onsite.remote).toBe(false);
    expect(hybridish.work_mode).toBe("半远端");
    expect(hybridish.remote).toBe(true);
  });

  it("detects employment type from job nature and work schedule hints", () => {
    const fullTime = parseIssueText(
      "[Remote] Quant Engineer",
      "## 工作性质\n- 是否全职：是\n- 是否远程：是",
    );
    const scheduleInferred = parseIssueText(
      "[ 全远端 ] 游戏集团 招 SEO主管",
      "工时：9小时 / 月休4天\n工作地点：居家办公",
    );

    expect(fullTime.employment_type).toBe("全职");
    expect(scheduleInferred.employment_type).toBe("全职");
  });

  it("parses numbered and emoji-prefixed headings", () => {
    const parsed = parseIssueText(
      "[Remote] Growth team hiring",
      [
        "1. 公司名称: 火星研究院",
        "2) 📍 工作地点: 深圳",
        "3- 💰 薪资: 35k-45k RMB/月",
        "4. 📬 联系方式: Telegram @mars_hr",
      ].join("\n"),
    );

    expect(parsed.company).toBe("火星研究院");
    expect(parsed.location).toBe("深圳");
    expect(parsed.salary_min).toBe(35000);
    expect(parsed.salary_max).toBe(45000);
    expect(parsed.contact_channels).toContain("telegram:@mars_hr");
  });

  it("parses markdown tables for key fields", () => {
    const parsed = parseIssueText(
      "[HK] Analytics Engineer",
      [
        "| 字段 | 内容 |",
        "| --- | --- |",
        "| 公司 | Oceanic Data |",
        "| 地点 | Hong Kong |",
        "| 雇佣类型 | Contract |",
      ].join("\n"),
    );

    expect(parsed.company).toBe("Oceanic Data");
    expect(parsed.location).toBe("Hong Kong");
    expect(parsed.employment_type).toBe("Contract");
  });

  it("splits compact multi-field metadata lines before parsing", () => {
    const parsed = parseIssueText(
      "[Remote/HK] 预测市场/DEX/CEX 公司诚聘 Quant Engineer 薪水RMB/USD",
      [
        "公司：DC公司地点：Remote & HK薪资：薪水RMB/USD远程",
        "是否全职：是",
        "联系方式：email:justinxu268@gmail.com TG：@jtx_2023",
      ].join("\n"),
    );

    expect(parsed.company).toBe("DC公司");
    expect(parsed.location).toBe("Remote & HK");
    expect(parsed.salary).toBe("薪水RMB/USD远程");
    expect(parsed.employment_type).toBe("全职");
    expect(parsed.contact_channels).toContain("email:justinxu268@gmail.com");
    expect(parsed.contact_channels).toContain("telegram:@jtx_2023");
  });

  it("extracts company from Chinese title hiring pattern", () => {
    const parsed = parseIssueText(
      "[ 全远端 ] 游戏集团诚聘 风控副经理 薪水 4000 - 7000 USD",
      [
        "岗位：风控副经理",
        "1.工作地：远程 居家（非中国远程）",
        "2.薪资范围：30-50K",
      ].join("\n"),
    );

    expect(parsed.company).toBe("游戏集团");
  });

  it("extracts company when title uses short 招 pattern", () => {
    const parsed = parseIssueText(
      "[ 全远端 ] 游戏集团 招 SEO主管 薪水 5000 - 8000 USD",
      "薪资：面议\n工作地点：居家办公",
    );

    expect(parsed.company).toBe("游戏集团");
    expect(parsed.salary).toContain("5000 - 8000 USD");
    expect(parsed.remote).toBe(true);
  });

  it("extracts english company prefix from title before chinese role text", () => {
    const parsed = parseIssueText(
      "[HK] water bear co,.limited 公链开发工程师 薪水 3000-8000USD/M",
      "工作地点：香港（全职线下）",
    );

    expect(parsed.company).toBe("water bear co,.limited");
  });

  it("extracts company from body intro sentences", () => {
    const parsed = parseIssueText(
      "老牌AI+web3公司诚聘 前端工程师 薪水3000-5000USD",
      [
        "Byterum 是一家由AI驱动的数字资产智能平台，自2020年创立起，便专注于用最前沿的技术重塑金融未来。",
        "工作地点：杭州",
      ].join("\n"),
    );

    expect(parsed.company).toBe("Byterum");
  });

  it("extracts heading-based responsibilities and avoids internet/intern false positives", () => {
    const parsed = parseIssueText(
      "[Remote] Community Manager",
      [
        "About Venturelabs",
        "",
        "We build internet-native products for Web3 founders.",
        "",
        "Key Responsibilities",
        "",
        "Develop and manage communities across X, Telegram, and Discord",
        "Design and execute long-term growth strategies",
        "",
        "Monthly Salary: $4,000-$5,000",
      ].join("\n"),
    );

    expect(parsed.summary).toContain("internet-native products");
    expect(parsed.responsibilities).toContain("Develop and manage communities");
    expect(parsed.salary_min).toBe(4000);
    expect(parsed.salary_max).toBe(5000);
    expect(parsed.employment_type).toBeNull();
  });

  it("extracts responsibilities and requirements from Chinese recruiting headings", () => {
    const rich = issueToRich({
      id: 3,
      number: 1071,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/1071",
      title: "[杭州] AI数字金融平台诚聘前端开发（React native） 25K+",
      body: [
        "核心挑战",
        "1. 主导构建融合AI与Web3的下一代移动应用架构。",
        "2. 实现钱包、链交互等Web3功能与移动端AI模块的高性能集成。",
        "",
        "我们需要的你",
        "硬核技能：精通React Native深度优化与复杂移动端架构设计。",
        "关键经验：拥有Web3（钱包/智能合约）或移动端AI（模型部署）任一领域的实践经验。",
      ].join("\n"),
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-05T14:00:00Z",
      updated_at: "2026-03-05T14:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(rich.responsibilities.join("\n")).toContain("主导构建融合AI与Web3的下一代移动应用架构");
    expect(rich.requirements.join("\n")).toContain("精通React Native深度优化与复杂移动端架构设计");
  });

  it("extracts headings like 主要职责 and 任职资格", () => {
    const parsed = parseIssueText(
      "[ 全远端 ] 游戏集团 招 SEO主管 薪水 5000 - 8000 USD",
      [
        "主要职责",
        "负责 中国市场推广策略与执行（SEO / SEM / 地推等）。",
        "规划推广渠道、进行市场调研并持续优化效果。",
        "",
        "任职资格",
        "5年以上市场推广经验，其中 3年以上中国市场管理经验。",
        "熟悉 SEO / SEM / 地推渠道运作（百度、Google等）。",
      ].join("\n"),
    );

    expect(parsed.responsibilities).toContain("中国市场推广策略与执行");
    expect(parsed.requirements).toContain("5年以上市场推广经验");
  });

  it("infers responsibilities from general numbered bullets before emoji requirement heading", () => {
    const rich = issueToRich({
      id: 5,
      number: 1073,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/1073",
      title: "[杭州] AI数字金融平台招聘后端开发工程师 30K+",
      body: [
        "1. 打造AI核心引擎：从零到一构建支撑大模型的高性能数据处理与服务系统。",
        "2. 实现AI能力产品化：深度开发与优化数据索引、模型服务化等模块。",
        "",
        "🛠️ 我们需要的你",
        "有AI框架（LangChain/LlamaIndex）、向量数据库经验。",
      ].join("\n"),
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-05T14:00:00Z",
      updated_at: "2026-03-05T14:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(rich.responsibilities.join("\n")).toContain("打造AI核心引擎");
    expect(rich.requirements.join("\n")).toContain("LangChain");
  });

  it("extracts mixed responsibility and requirement sections with loose headings", () => {
    const rich = issueToRich({
      id: 7,
      number: 2023,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/2023",
      title: "[Remote] 量化团队诚聘 预测市场 / DEX 策略研究员 远程 薪水 2000-4000 USD",
      body: [
        "## 岗位要求、职责",
        "- 监控Polymarket等预测市场，识别概率偏差、跨平台价差等机会，并自行验证。",
        "- 将发现转化为脚本或bot的prototype，进行测试。",
        "",
        "职位要求：",
        "- 亲自在Polymarket或其他预测市场发现并验证过套利机会，有代码、交易记录或截图可分享。",
        "- 了解预测市场基本机制（概率定价、结算风险）。",
        "",
        "## 工作环境",
        "• 1-2年区块链经验。",
      ].join("\n"),
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-05T14:00:00Z",
      updated_at: "2026-03-05T14:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(rich.responsibilities.join("\n")).toContain("监控Polymarket等预测市场");
    expect(rich.requirements.join("\n")).toContain("亲自在Polymarket或其他预测市场发现并验证过套利机会");
    expect(rich.requirements.join("\n")).toContain("1-2年区块链经验");
  });

  it("treats bold markdown section markers as empty headings, not content", () => {
    const rich = issueToRich({
      id: 4,
      number: 1078,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/1078",
      title: "【远程】- CEX - 风控审核岗",
      body: [
        "**岗位职责：**",
        "- 审批并记录用户的夜间出金请求，识别潜在风险行为；",
        "**任职要求：**",
        "- 大专及以上学历，计算机、金融、数学或相关专业优先;",
      ].join("\n"),
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-05T14:00:00Z",
      updated_at: "2026-03-05T14:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(rich.responsibilities.join("\n")).toContain("审批并记录用户的夜间出金请求");
    expect(rich.requirements.join("\n")).toContain("大专及以上学历");
    expect(rich.responsibilities).not.toContain("**");
    expect(rich.requirements).not.toContain("**");
  });

  it("filters employer-pitch paragraphs out of requirements", () => {
    const rich = issueToRich({
      id: 6,
      number: 1074,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/1074",
      title: "[杭州]AI金融平台诚聘资深测试工程师",
      body: [
        "**你需要搞定**",
        "- 负责Web端、App端全流程测试，从功能、性能到稳定性，守住产品上线前的最后一道关",
        "**我们希望你**",
        "- 有Web和App双端测试实战经验，能写代码、能搭环境、能搞自动化",
        "明星团队背书：核心成员来自全球顶尖高校，具备平均8年以上实战经验。",
      ].join("\n"),
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-05T14:00:00Z",
      updated_at: "2026-03-05T14:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(rich.requirements.join("\n")).toContain("有Web和App双端测试实战经验");
    expect(rich.requirements.join("\n")).not.toContain("明星团队背书");
  });

  it("does not parse contact phone ranges as salary", () => {
    const parsed = parseIssueText(
      "Hiring talented professionals for our next generation ecommerce platform",
      [
        "If this sounds like something you'd be interested in, feel free to contact us.",
        "WhatsApp :: +1 (763) 328-8050",
        "Or telegram: @clitchdao",
      ].join("\n"),
    );

    expect(parsed.salary).toBeNull();
    expect(parsed.salary_min).toBeNull();
    expect(parsed.salary_max).toBeNull();
  });

  it("finds salary after generic 薪资福利待遇 headings", () => {
    const parsed = parseIssueText(
      "[远程] Krupisen 公司诚聘 Content Creator，薪水 2,500 美元",
      [
        "薪资福利待遇",
        "月薪 $2,500-$3,000（根据经验而定）",
      ].join("\n"),
    );

    expect(parsed.salary).toContain("$2,500-$3,000");
    expect(parsed.salary_min).toBe(2500);
    expect(parsed.salary_max).toBe(3000);
    expect(parsed.salary_period).toBe("month");
  });

  it("extracts direct contact handles from vx and standalone contact lines", () => {
    const parsed = parseIssueText(
      "[远程] cex/dex公司诚聘 golang/java/sre/量化/产品/运营/市场",
      [
        "联系方式：@nature000111",
        "VX: Aurora_Wanax",
        "咨询",
        "@Lucky_V168",
      ].join("\n"),
    );

    expect(parsed.contact_channels).toContain("contact:@nature000111");
    expect(parsed.contact_channels).toContain("wechat:Aurora_Wanax");
    expect(parsed.contact_channels).toContain("contact:@Lucky_V168");
  });

  it("treats explicit 是否远程：否 as non-remote", () => {
    const parsed = parseIssueText(
      "[HK] water bear co,.limited 公链开发工程师 薪水 3000-8000USD/M",
      [
        "工作地点：香港（全职线下）",
        "是否远程：否",
      ].join("\n"),
    );

    expect(parsed.work_mode).toBe("非远程");
    expect(parsed.remote).toBe(false);
    expect(parsed.salary_period).toBe("month");
  });
});

describe("issueToRich", () => {
  it("extracts rich sections and narrative for issue-style content", () => {
    const rich = issueToRich({
      id: 2,
      number: 1068,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/1068",
      title: "[Remote] Venturelabs is hiring a Community Manager, salary $4,000 - $5,000",
      body: [
        "Job Title: Community Manager",
        "",
        "Location: Remote",
        "Company: Venturelabs",
        "",
        "About Venturelabs",
        "",
        "Venturelabs is an early-stage venture capital fund supporting builders of Web3 and crypto infrastructure.",
        "",
        "Role Overview",
        "",
        "You will shape the voice of Venturelabs and strengthen the ecosystem.",
        "",
        "Monthly Salary: $4,000-$5,000",
        "",
        "Contact information: vntxlabs@vxnturelabs.com / Telegram: @VXNTURELABS",
        "",
        "Key Responsibilities",
        "",
        "- Develop and manage communities across X, Telegram, Discord, and LinkedIn",
        "- Design and execute community growth strategies",
        "",
        "Requirements",
        "",
        "- 2+ years of experience in Web3 community operations",
        "- Strong understanding of DeFi and blockchain infrastructure",
      ].join("\n"),
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-05T14:00:00Z",
      updated_at: "2026-03-05T14:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(rich.summary).toContain("Venturelabs is an early-stage venture capital fund");
    expect(rich.narrative.join("\n")).toContain("shape the voice of Venturelabs");
    expect(rich.responsibilities.join("\n")).toContain("Develop and manage communities");
    expect(rich.requirements.join("\n")).toContain("2+ years of experience");
    expect(rich.contact_details).toContain("email:vntxlabs@vxnturelabs.com");
    expect(rich.contact_details).toContain("telegram:@VXNTURELABS");
    expect(rich.sections.some((section) => section.title === "Role Overview")).toBe(true);
  });
});

describe("isLikelyHiringRichJob", () => {
  it("filters out obvious non-job issues", () => {
    const rich = issueToRich({
      id: 875,
      number: 875,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/875",
      title: "Feature Request: Add Job Categories to Job Listings",
      body: "Problem: job listings need categories.",
      labels: [],
      state: "open",
      created_at: "2026-03-04T10:00:00Z",
      updated_at: "2026-03-04T10:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(isLikelyHiringRichJob(rich)).toBe(false);
  });
});

describe("issueToNormalized", () => {
  it("builds normalized record with enriched fields", () => {
    const normalized = issueToNormalized({
      id: 1,
      number: 10,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/10",
      title: "[HK/Remote] Example Co hiring QA Engineer",
      body: [
        "Salary: 30K-50K HKD / month",
        "Employment Type: Contract",
        "Contact: https://t.me/example_hr",
      ].join("\n"),
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-04T10:00:00Z",
      updated_at: "2026-03-04T10:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(normalized.number).toBe(10);
    expect(normalized.labels).toEqual(["jobs"]);
    expect(normalized.author).toBe("alice");
    expect(normalized.remote).toBe(true);
    expect(normalized.salary_currency).toBe("HKD");
    expect(normalized.salary_period).toBe("month");
    expect(normalized.employment_type).toBe("Contract");
    expect(normalized.contact_channels).toContain("https://t.me/example_hr");
    expect(normalized.completeness_score).toBe(78);
    expect(normalized.completeness_grade).toBe("C");
    expect(normalized.missing_fields).toEqual(["responsibilities", "requirements"]);
  });

  it("keeps multi-line responsibilities and requirements for scoring", () => {
    const normalized = issueToNormalized({
      id: 2,
      number: 1074,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/1074",
      title: "[杭州]AI金融平台诚聘资深测试工程师",
      body: [
        "**你需要搞定**",
        "- 负责Web端、App端全流程测试，从功能、性能到稳定性，守住产品上线前的最后一道关",
        "- 搭建和维护测试框架，设计测试用例，确保金融交易场景下的高可用和高安全",
        "- 探索用AI提效——如果你能用大模型搭建内部测试环境、自动化生成测试用例",
        "",
        "**我们希望你**",
        "- 有Web和App双端测试实战经验，能写代码、能搭环境、能搞自动化",
        "- 有金融科技类产品测试经历优先——懂交易场景、懂资金安全的分量",
        "- 细心、较真、有owner意识，敢为质量拍桌子",
        "",
        "现场办公：杭州",
        "TG：daisy51518",
      ].join("\n"),
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-04T10:00:00Z",
      updated_at: "2026-03-04T10:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(normalized.responsibilities).toContain("负责Web端、App端全流程测试");
    expect(normalized.responsibilities).toContain("搭建和维护测试框架");
    expect(normalized.requirements).toContain("有Web和App双端测试实战经验");
    expect(normalized.requirements).toContain("懂交易场景、懂资金安全的分量");
    expect(normalized.weak_fields).not.toContain("responsibilities");
    expect(normalized.weak_fields).not.toContain("requirements");
  });

  it("prefers richer section-derived text over shorter field captures", () => {
    const normalized = issueToNormalized({
      id: 3,
      number: 1027,
      html_url: "https://github.com/rebase-network/who-is-hiring/issues/1027",
      title: "【远程】区块链基础设施公司诚聘资深钱包后端开发工程师_远程_持续招聘",
      body: [
        "### 职责",
        "* 开发和维护核心钱包后端服务，负责交易相关后端系统的稳定性与可靠性。",
        "* 设计和实现交易相关核心能力，包括：",
        "  - 交易接口：构造、发送并跟踪 EVM 交易，处理 ERC-20 代币及智能合约交互。",
        "  - 钱包预执行：实现交易模拟、Gas 估算与错误检测，识别潜在失败与异常场景。",
        "* 构建高性能、高可用的钱包后端 API，支撑高并发交易请求与复杂链上环境。",
        "### 职位要求",
        "* 5 年以上后端开发经验，熟练使用 Go, Node.js (TypeScript) 或 Rust。",
        "* 2 年以上钱包业务开发经验。",
        "* 深入理解区块链基础，熟悉 EVM 及其生态系统。",
        "* 良好的沟通和团队协作能力。",
      ].join("\n"),
      labels: [{ name: "jobs" }],
      state: "open",
      created_at: "2026-03-04T10:00:00Z",
      updated_at: "2026-03-04T10:00:00Z",
      closed_at: null,
      user: { login: "alice" },
    });

    expect(normalized.responsibilities).toContain("交易接口：构造、发送并跟踪 EVM 交易");
    expect(normalized.requirements).toContain("深入理解区块链基础");
    expect(normalized.weak_fields).not.toContain("responsibilities");
    expect(normalized.weak_fields).not.toContain("requirements");
  });
});
