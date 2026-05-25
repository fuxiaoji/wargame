# 测试结果索引

| 日期 | 测试 | 文件夹 | 关键结论 |
|------|------|--------|---------|
| 05-24 | V4 交叉评估 | `2026-05-24_v4_cross_eval/` | V4英军 vs V2/V3英军巨大进步 |
| 05-25 | Patrol 消融 | `2026-05-25_patrol_ablation/` | Patrol +18% 英军胜率 |
| 05-25 | 传播交叉验证 | `2026-05-25_propagation_cross/` | 仅负值×仅负值=42%最优 |
| 05-25 | 传播 A/B | `2026-05-25_propagation_ablation/` | V1德+45%, V4德无效果 |
| 05-25 | 随机基线 | `2026-05-25_random_baseline/` | V4德最强(67%), V1/V3英最强(80%) |

## 工作流

```bash
# 运行测试脚本
npx tsx bismarck/cli/test-<name>.ts

# 结果自动保存到 test_results/<date>_<name>/
# 包含: report.md (分析) + raw_data.json (原始数据)
```
