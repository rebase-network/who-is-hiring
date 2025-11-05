# Who is Hiring - Website

这是 Rebase 社区招聘平台的前端网站项目。

## 功能特性

- 📱 响应式设计，完美支持移动端和桌面端
- 🔍 实时搜索招聘信息
- 🎯 按地点筛选职位
- 🎨 现代化 UI 设计
- 🔄 自动从 GitHub Issues 获取最新招聘信息
- 🚀 自动部署到 GitHub Pages

## 技术栈

- React 18
- Vite
- Tailwind CSS
- Lucide React (图标库)

## 本地开发

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173 查看效果

### 构建生产版本

```bash
npm run build
```

构建后的文件将输出到 `dist` 目录。

### 预览生产构建

```bash
npm run preview
```

## 部署

项目通过 GitHub Actions 自动部署到 GitHub Pages。

每当 `website/` 目录下的文件发生变化并推送到主分支时，会自动触发部署流程。

## 数据来源

招聘信息直接从 GitHub Issues API 获取：
- 仓库：`rebase-network/who-is-hiring`
- API: https://api.github.com/repos/rebase-network/who-is-hiring/issues

## 如何发布职位

访问 [GitHub Issues](https://github.com/rebase-network/who-is-hiring/issues/new) 创建新的 Issue 即可发布职位。

建议的标题格式：
```
[地点] 公司名称 诚聘 职位名称 薪水 XXX-XXX RMB/USD
```

例如：
```
[远程] Web3公司 诚聘 高级区块链工程师 薪水 30K-50K RMB
```

## License

MIT
