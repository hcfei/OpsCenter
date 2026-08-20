/* 看板聚合路由模块
 * API:
 *   GET /api/dashboard/summary - 经营看板汇总
 *   GET /api/dashboard/kpi     - KPI 指标
 */

let registerRoute, getPool, send, readBody;

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  send = ctx.send;
  readBody = ctx.readBody;
  getPool = ctx.getPool;

  // GET /api/dashboard/summary - 经营看板汇总
  registerRoute('GET', '/api/dashboard/summary', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const year = parseInt(urlObj.searchParams.get('year') || new Date().getFullYear(), 10);

    // 查询实际数据汇总
    const [[actual]] = await pool.query(`
      SELECT
        SUM(actual_revenue) as revenue,
        SUM(actual_profit) as profit,
        SUM(actual_cash) as cash,
        SUM(actual_expense) as expense
      FROM ops_actual WHERE year=?
    `, [year]);

    // 查询预算数据汇总
    const [[budget]] = await pool.query(`
      SELECT
        SUM(budget_revenue) as revenue,
        SUM(budget_profit) as profit,
        SUM(budget_cash) as cash,
        SUM(budget_expense) as expense
      FROM ops_budget WHERE year=?
    `, [year]);

    // 查询预测数据汇总
    const [[forecast]] = await pool.query(`
      SELECT
        SUM(forecast_revenue) as revenue,
        SUM(contribution_profit) as profit,
        SUM(cash_flow) as cash,
        SUM(expense) as expense
      FROM ops_forecast WHERE year=?
    `, [year]);

    ctx.send(200, {
      year,
      actual: {
        revenue: Number(actual?.revenue) || 0,
        profit: Number(actual?.profit) || 0,
        cash: Number(actual?.cash) || 0,
        expense: Number(actual?.expense) || 0
      },
      budget: {
        revenue: Number(budget?.revenue) || 0,
        profit: Number(budget?.profit) || 0,
        cash: Number(budget?.cash) || 0,
        expense: Number(budget?.expense) || 0
      },
      forecast: {
        revenue: Number(forecast?.revenue) || 0,
        profit: Number(forecast?.profit) || 0,
        cash: Number(forecast?.cash) || 0,
        expense: Number(forecast?.expense) || 0
      }
    });
  });

  // GET /api/dashboard/kpi - KPI 指标
  registerRoute('GET', '/api/dashboard/kpi', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const year = parseInt(urlObj.searchParams.get('year') || new Date().getFullYear(), 10);

    // 按 BU 汇总
    const [buData] = await pool.query(`
      SELECT
        bu,
        SUM(actual_revenue) as revenue,
        SUM(actual_profit) as profit,
        SUM(budget_revenue) as budget_revenue,
        SUM(budget_profit) as budget_profit
      FROM ops_actual a
      LEFT JOIN ops_budget b ON a.year=b.year AND a.month=b.month AND a.bu=b.bu
      WHERE a.year=?
      GROUP BY bu
    `, [year]);

    const kpis = buData.map(bu => ({
      bu: bu.bu,
      revenue: Number(bu.revenue) || 0,
      budgetRevenue: Number(bu.budget_revenue) || 0,
      profit: Number(bu.profit) || 0,
      budgetProfit: Number(bu.budget_profit) || 0,
      revenueAch: bu.budget_revenue > 0 ? (bu.revenue / bu.budget_revenue * 100).toFixed(1) + '%' : 'N/A',
      profitAch: bu.budget_profit > 0 ? (bu.profit / bu.budget_profit * 100).toFixed(1) + '%' : 'N/A'
    }));

    ctx.send(200, { year, kpis });
  });
};
