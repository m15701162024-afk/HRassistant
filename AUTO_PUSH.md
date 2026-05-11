# GitHub 自动推送说明

本项目已配置 Git hook：

```bash
git config core.hooksPath .githooks
```

之后每次执行 `git commit` 成功后，`.githooks/post-commit` 会自动执行：

```bash
git push origin 当前分支
```

## 首次绑定 GitHub 仓库

创建好 GitHub 仓库后，在项目根目录执行：

```bash
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

## 临时跳过自动推送

```bash
SKIP_AUTO_PUSH=1 git commit -m "message"
```

## 注意

自动推送发生在提交之后。未提交的文件不会被推送；如需推送更新，请先 `git add` 和 `git commit`。
