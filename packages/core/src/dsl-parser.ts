import {
  Decimal,
  roundCny,
  formatCny,
  formatRate,
  sumCny,
  toDecimal,
} from './money.js';
import {
  Category,
  ProjectTag,
  BudgetPool,
  TransactionType,
  AllocationMode,
  SettlementStatus,
  SplitItemInput,
  FxPreferenceConfig,
} from './types.js';
import { allocateSplitDiscounts } from './allocation.js';
import {
  processMastercardFxLifecycle,
  DEFAULT_FX_RATES,
} from './mastercard-fx.js';

// ============================================================================
// 1. 默认种子字典常量定义（与 PRD 12.1 ~ 12.4 严格对齐）
// ============================================================================

/**
 * PRD 12.3: 14 个标准消费与属性分类（含全套自动匹配关键词与关联预算池）
 */
export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: 'CAT_FOOD',
    parent_id: null,
    name: '餐饮零食与水饮',
    default_pool_id: 'POOL_DAILY',
    icon_name: null,
    keywords: '饭卡,食堂,华莱士,塔斯汀,牛奶,芬达,可乐,面,面包,水果,甘果子,鱼干',
    sort_order: 10,
  },
  {
    id: 'CAT_CLEAN',
    parent_id: null,
    name: '日常洗护与消耗',
    default_pool_id: 'POOL_DAILY',
    icon_name: null,
    keywords: '洗衣服,洗衣液,纸巾,抽纸,牙线,牙膏,洗发水',
    sort_order: 20,
  },
  {
    id: 'CAT_TELECOM',
    parent_id: null,
    name: '通信话费与理发',
    default_pool_id: 'POOL_FIXED',
    icon_name: null,
    keywords: '话费,移动,电信,联通,理发,剪头',
    sort_order: 30,
  },
  {
    id: 'CAT_GAME_FIXED',
    parent_id: null,
    name: '游戏固定大小月卡',
    default_pool_id: 'POOL_FIXED',
    icon_name: null,
    keywords: '小月卡,大月卡,空月祝福,珍珠纪行',
    sort_order: 40,
  },
  {
    id: 'CAT_CLOTH',
    parent_id: null,
    name: '服饰鞋帽与床品',
    default_pool_id: 'POOL_FLEX',
    icon_name: null,
    keywords: '短袖,裤子,内裤,袜子,床单,被套,鞋子',
    sort_order: 50,
  },
  {
    id: 'CAT_DAILY_GOODS',
    parent_id: null,
    name: '宿舍日用百货',
    default_pool_id: 'POOL_FLEX',
    icon_name: null,
    keywords: '衣架,挂钩,泡面碗,指甲剪,卷尺,理线器,书架,电池,打气筒',
    sort_order: 60,
  },
  {
    id: 'CAT_EE_DEV',
    parent_id: null,
    name: '电子电路与开发',
    default_pool_id: 'POOL_FLEX',
    icon_name: null,
    keywords: 'MSP430,MSPM0,开发板,J-Link,示波器,探头,排针,电容,电阻,焊接',
    sort_order: 70,
  },
  {
    id: 'CAT_DIGITAL_SUB',
    parent_id: null,
    name: '软件订阅与外设',
    default_pool_id: 'POOL_FLEX',
    icon_name: null,
    keywords: '域名,Porkbun,阿里云,MOJITEST,鼠标垫,数据线,磁吸镜片,Pico',
    sort_order: 80,
  },
  {
    id: 'CAT_STUDY_PRINT',
    parent_id: null,
    name: '打印与学习资料',
    default_pool_id: 'POOL_FLEX',
    icon_name: null,
    keywords: '打印,复印,教材,题库,文具',
    sort_order: 90,
  },
  {
    id: 'CAT_TRAFFIC',
    parent_id: null,
    name: '日常市内交通',
    default_pool_id: 'POOL_FLEX',
    icon_name: null,
    keywords: '公交,地铁,单车,打车',
    sort_order: 100,
  },
  {
    id: 'CAT_MEDICAL',
    parent_id: null,
    name: '医疗买药与保健',
    default_pool_id: 'POOL_EMERGENCY',
    icon_name: null,
    keywords: '维生素,溃疡,医院,门诊,冷冻,碘伏,棉签,药',
    sort_order: 110,
  },
  {
    id: 'CAT_REPAIR',
    parent_id: null,
    name: '突发损坏与维修',
    default_pool_id: 'POOL_EMERGENCY',
    icon_name: null,
    keywords: '修车,内外胎,卡槽,维修,发霉替换',
    sort_order: 120,
  },
  {
    id: 'CAT_EXAM_CERT',
    parent_id: null,
    name: '考证报名与差旅',
    default_pool_id: 'POOL_FLEX',
    icon_name: null,
    keywords: 'JLPT,N2,报名费,护照,港澳通行证,青旅,考点住宿',
    sort_order: 130,
  },
  {
    id: 'CAT_MAJOR_ASSET',
    parent_id: null,
    name: '数码大件购置',
    default_pool_id: 'POOL_FLEX',
    icon_name: null,
    keywords: 'iPhone,手机,机械硬盘,希捷,固态硬盘,显示器',
    sort_order: 140,
  },
];

/**
 * PRD 12.4: 3 个初始专项与场景标签
 */
export const DEFAULT_PROJECT_TAGS: ProjectTag[] = [
  {
    id: 'TAG_JLPT_N2',
    name: 'JLPT_N2考试专项',
    tag_type: 'PROJECT',
    target_budget: '800.00',
    linked_pool_id: 'POOL_FLEX',
    is_active: true,
  },
  {
    id: 'TAG_MCU_LAB',
    name: '单片机硬件实验',
    tag_type: 'SCENE',
    target_budget: null,
    linked_pool_id: 'POOL_FLEX',
    is_active: true,
  },
  {
    id: 'TAG_STOCK_EAT',
    name: '靠存货/刷饭卡度日',
    tag_type: 'STOCK_CONSUME',
    target_budget: null,
    linked_pool_id: 'POOL_DAILY',
    is_active: true,
  },
];

// ============================================================================
// 2. 常见别名映射表 (分类简写、专项标签)
// ============================================================================

const CATEGORY_ALIASES: Record<string, string> = {
  饮食: 'CAT_FOOD',
  餐饮: 'CAT_FOOD',
  吃喝: 'CAT_FOOD',
  零食: 'CAT_FOOD',
  水饮: 'CAT_FOOD',
  洗护: 'CAT_CLEAN',
  日化: 'CAT_CLEAN',
  消耗: 'CAT_CLEAN',
  通信: 'CAT_TELECOM',
  话费: 'CAT_TELECOM',
  理发: 'CAT_TELECOM',
  游戏: 'CAT_GAME_FIXED',
  月卡: 'CAT_GAME_FIXED',
  服饰: 'CAT_CLOTH',
  衣服: 'CAT_CLOTH',
  鞋帽: 'CAT_CLOTH',
  床品: 'CAT_CLOTH',
  日用: 'CAT_DAILY_GOODS',
  百货: 'CAT_DAILY_GOODS',
  宿舍日用: 'CAT_DAILY_GOODS',
  电子: 'CAT_EE_DEV',
  电路: 'CAT_EE_DEV',
  开发: 'CAT_EE_DEV',
  单片机: 'CAT_EE_DEV',
  数字服务: 'CAT_DIGITAL_SUB',
  软件订阅: 'CAT_DIGITAL_SUB',
  订阅: 'CAT_DIGITAL_SUB',
  外设: 'CAT_DIGITAL_SUB',
  学习: 'CAT_STUDY_PRINT',
  打印: 'CAT_STUDY_PRINT',
  资料: 'CAT_STUDY_PRINT',
  交通: 'CAT_TRAFFIC',
  出行: 'CAT_TRAFFIC',
  医疗: 'CAT_MEDICAL',
  买药: 'CAT_MEDICAL',
  保健: 'CAT_MEDICAL',
  维修: 'CAT_REPAIR',
  修理: 'CAT_REPAIR',
  考证: 'CAT_EXAM_CERT',
  报名: 'CAT_EXAM_CERT',
  差旅: 'CAT_EXAM_CERT',
  大件: 'CAT_MAJOR_ASSET',
  数码大件: 'CAT_MAJOR_ASSET',
};

const PROJECT_TAG_ALIASES: Record<string, string> = {
  jlpt_n2考试: 'TAG_JLPT_N2',
  jlpt_n2: 'TAG_JLPT_N2',
  jlpt: 'TAG_JLPT_N2',
  n2: 'TAG_JLPT_N2',
  n2考试: 'TAG_JLPT_N2',
  mcu: 'TAG_MCU_LAB',
  单片机: 'TAG_MCU_LAB',
  硬件实验: 'TAG_MCU_LAB',
  单片机硬件实验: 'TAG_MCU_LAB',
  存货: 'TAG_STOCK_EAT',
  刷饭卡: 'TAG_STOCK_EAT',
  靠存货: 'TAG_STOCK_EAT',
  '靠存货/刷饭卡度日': 'TAG_STOCK_EAT',
};

// ============================================================================
// 3. 安全算术表达式求值器 (Lexer + Recursive Descent Parser)
// 严禁使用 eval 或 new Function，所有浮点运算基于 Decimal.js
// ============================================================================

interface MathToken {
  type: 'NUMBER' | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH' | 'LPAREN' | 'RPAREN';
  value?: Decimal;
  raw: string;
}

function tokenizeMathExpr(expr: string): MathToken[] {
  const tokens: MathToken[] = [];
  let i = 0;
  const s = expr.trim();
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '+') {
      tokens.push({ type: 'PLUS', raw: '+' });
      i++;
    } else if (ch === '-') {
      tokens.push({ type: 'MINUS', raw: '-' });
      i++;
    } else if (ch === '*') {
      tokens.push({ type: 'STAR', raw: '*' });
      i++;
    } else if (ch === '/') {
      tokens.push({ type: 'SLASH', raw: '/' });
      i++;
    } else if (ch === '(') {
      tokens.push({ type: 'LPAREN', raw: '(' });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: 'RPAREN', raw: ')' });
      i++;
    } else if (/[\d.]/.test(ch)) {
      let numStr = '';
      while (i < s.length && /[\d.]/.test(s[i])) {
        numStr += s[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: new Decimal(numStr), raw: numStr });
    } else {
      throw new Error(`Unexpected character '${ch}' in arithmetic expression`);
    }
  }
  return tokens;
}

class RecursiveDescentMathParser {
  private tokens: MathToken[];
  private pos = 0;

  constructor(tokens: MathToken[]) {
    this.tokens = tokens;
  }

  private peek(): MathToken | undefined {
    return this.tokens[this.pos];
  }

  private next(): MathToken {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error('Unexpected end of arithmetic expression');
    return t;
  }

  public parse(): Decimal {
    if (this.tokens.length === 0) {
      return new Decimal(0);
    }
    const res = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token '${this.tokens[this.pos].raw}'`);
    }
    return res;
  }

  private parseExpression(): Decimal {
    return this.parseAdditive();
  }

  private parseAdditive(): Decimal {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === 'PLUS' || this.peek()?.type === 'MINUS') {
      const op = this.next().type;
      const right = this.parseMultiplicative();
      if (op === 'PLUS') {
        left = left.plus(right);
      } else {
        left = left.minus(right);
      }
    }
    return left;
  }

  private parseMultiplicative(): Decimal {
    let left = this.parsePrimary();
    while (this.peek()?.type === 'STAR' || this.peek()?.type === 'SLASH') {
      const op = this.next().type;
      const right = this.parsePrimary();
      if (op === 'STAR') {
        left = left.times(right);
      } else {
        if (right.isZero()) {
          throw new Error('Division by zero');
        }
        left = left.dividedBy(right);
      }
    }
    return left;
  }

  private parsePrimary(): Decimal {
    const tok = this.peek();
    if (!tok) {
      throw new Error('Unexpected end of expression');
    }
    if (tok.type === 'PLUS') {
      this.next();
      return this.parsePrimary();
    }
    if (tok.type === 'MINUS') {
      this.next();
      return this.parsePrimary().negated();
    }
    if (tok.type === 'NUMBER') {
      this.next();
      return tok.value!;
    }
    if (tok.type === 'LPAREN') {
      this.next();
      const val = this.parseExpression();
      const closing = this.next();
      if (closing.type !== 'RPAREN') {
        throw new Error("Expected ')'");
      }
      return val;
    }
    throw new Error(`Unexpected token '${tok.raw}'`);
  }
}

/**
 * 导出安全算术表达式求值器
 * 支持非负小数、+、-、*、/、括号 (...)
 *
 * 对于形如 16.8-0.15 或 20-1.08*3 的单品优惠算式：
 * - 第一项正数部分之和记为 gross（如 16.8 -> 16.80, 20 -> 20.00）
 * - 减去部分记为单品 discount（如 0.15 -> 0.15, 1.08*3 -> 3.24）
 * - 最终计算结果记为 net（如 16.65, 16.76）
 * - 若算式仅为纯数字或乘法（如 28 或 3.5*2），则 gross = net, discount = "0.00"
 */
export function evaluateMathFormula(expr: string): {
  gross: string;
  discount: string;
  net: string;
} {
  const trimmed = expr.trim();
  if (!trimmed) {
    throw new Error('Empty arithmetic expression');
  }

  const tokens = tokenizeMathExpr(trimmed);
  if (tokens.length === 0) {
    throw new Error('Empty arithmetic expression');
  }

  // 1. 全局计算净额 net
  const netVal = new RecursiveDescentMathParser(tokens).parse();

  // 2. 检查顶层括号深度为 0 的加减法切分项
  interface TopLevelTerm {
    sign: '+' | '-';
    tokens: MathToken[];
  }

  const terms: TopLevelTerm[] = [];
  let currentSign: '+' | '-' = '+';
  let currentTokens: MathToken[] = [];
  let depth = 0;
  let hasTopLevelMinus = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'LPAREN') {
      depth++;
      currentTokens.push(t);
    } else if (t.type === 'RPAREN') {
      depth--;
      if (depth < 0) {
        throw new Error("Mismatched ')' in expression");
      }
      currentTokens.push(t);
    } else if (depth === 0 && (t.type === 'PLUS' || t.type === 'MINUS')) {
      if (currentTokens.length > 0) {
        terms.push({ sign: currentSign, tokens: currentTokens });
        currentTokens = [];
      } else if (t.type === 'MINUS') {
        currentSign = '-';
        continue;
      }
      currentSign = t.type === 'PLUS' ? '+' : '-';
      if (t.type === 'MINUS') {
        hasTopLevelMinus = true;
      }
    } else {
      currentTokens.push(t);
    }
  }

  if (currentTokens.length > 0) {
    terms.push({ sign: currentSign, tokens: currentTokens });
  }

  // 若没有顶层减号（如纯数字、乘法、仅加法或被括号完全包裹），gross = net, discount = 0.00
  if (!hasTopLevelMinus) {
    const netFormatted = formatCny(netVal);
    return {
      gross: netFormatted,
      discount: '0.00',
      net: netFormatted,
    };
  }

  // 若存在顶层减号（如 16.8-0.15 或 20-1.08*3）
  let positiveSum = new Decimal(0);
  let negativeSum = new Decimal(0);

  for (const term of terms) {
    const termVal = new RecursiveDescentMathParser(term.tokens).parse();
    if (term.sign === '+') {
      positiveSum = positiveSum.plus(termVal);
    } else {
      negativeSum = negativeSum.plus(termVal);
    }
  }

  const grossFormatted = formatCny(positiveSum);
  const discountFormatted = formatCny(negativeSum);
  const netFormatted = formatCny(netVal);

  return {
    gross: grossFormatted,
    discount: discountFormatted,
    net: netFormatted,
  };
}

// ============================================================================
// 4. 解析结果结构与上下文接口定义
// ============================================================================

export interface ParsedDslItemResult {
  item_name: string;
  category_id: string;
  budget_pool_id: string;
  project_tag_id: string | null;
  item_gross: string;
  allocated_discount: string;
  item_net: string;
  is_primary_item: boolean;
  raw_formula_expr: string | null;
}

export interface ParsedDslResult {
  tx_type: TransactionType;
  total_gross: string;
  platform_discount: string;
  payment_discount: string;
  total_net: string;
  allocation_mode: AllocationMode;
  original_currency: string;
  original_amount: string | null;
  exchange_rate: string;
  settlement_status: SettlementStatus;
  hold_amount_cny: string;
  fx_cashback_rate?: string | null;
  is_fx_detected: boolean;
  items: ParsedDslItemResult[];
  raw_input_text: string;
  merchant_or_note: string;
}

export interface DslParserContext {
  categories?: Category[];
  projectTags?: ProjectTag[];
  budgetPools?: BudgetPool[];
  txDate?: string;
  fxConfig?: FxPreferenceConfig;
}

// ============================================================================
// 5. 辅助解析方法：分类与专项标签匹配、关键词归类
// ============================================================================

function resolveTagOrCategory(
  rawTag: string,
  categories: Category[],
  projectTags: ProjectTag[],
  budgetPools?: BudgetPool[]
): {
  category?: Category;
  projectTag?: ProjectTag;
  budgetPool?: BudgetPool;
} {
  const clean = rawTag.replace(/^#/, '').trim();
  const lower = clean.toLowerCase();

  // A. 优先匹配专项项目标签
  const tagAliasId = PROJECT_TAG_ALIASES[lower] ?? PROJECT_TAG_ALIASES[clean];
  if (tagAliasId) {
    const pt = projectTags.find((p) => p.id === tagAliasId);
    if (pt) return { projectTag: pt };
  }

  const ptById = projectTags.find((p) => p.id.toLowerCase() === lower);
  if (ptById) return { projectTag: ptById };

  const ptByName = projectTags.find((p) => p.name.toLowerCase() === lower);
  if (ptByName) return { projectTag: ptByName };

  const ptBySub = projectTags.find(
    (p) =>
      p.name.toLowerCase().includes(lower) ||
      lower.includes(p.name.toLowerCase())
  );
  if (ptBySub) return { projectTag: ptBySub };

  // B. 匹配月度资金池 (BudgetPool)
  if (budgetPools && budgetPools.length > 0) {
    const bpById = budgetPools.find((p) => p.id.toLowerCase() === lower);
    if (bpById) return { budgetPool: bpById };

    const bpByName = budgetPools.find((p) => p.name.toLowerCase() === lower);
    if (bpByName) return { budgetPool: bpByName };

    const bpBySub = budgetPools.find(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        lower.includes(p.name.toLowerCase())
    );
    if (bpBySub) return { budgetPool: bpBySub };
  }

  // C. 匹配商品服务分类
  const catAliasId = CATEGORY_ALIASES[lower] ?? CATEGORY_ALIASES[clean];
  if (catAliasId) {
    const cat = categories.find((c) => c.id === catAliasId);
    if (cat) return { category: cat };
  }

  const catById = categories.find((c) => c.id.toLowerCase() === lower);
  if (catById) return { category: catById };

  const catByName = categories.find((c) => c.name.toLowerCase() === lower);
  if (catByName) return { category: catByName };

  const catBySub = categories.find(
    (c) =>
      c.name.toLowerCase().includes(lower) ||
      lower.includes(c.name.toLowerCase())
  );
  if (catBySub) return { category: catBySub };

  // 关键词倒查
  const catByKeyword = categories.find((c) => {
    if (!c.keywords) return false;
    const kwList = c.keywords.split(',').map((k) => k.trim().toLowerCase());
    return kwList.some((kw) => kw === lower || lower.includes(kw));
  });
  if (catByKeyword) return { category: catByKeyword };

  return {};
}

function autoMatchCategoryByItemName(
  itemName: string,
  categories: Category[]
): Category | null {
  const nameLower = itemName.toLowerCase();
  let bestMatch: Category | null = null;
  let maxKwLength = 0;

  for (const cat of categories) {
    if (!cat.keywords) continue;
    const kwList = cat.keywords.split(',').map((k) => k.trim());
    for (const kw of kwList) {
      if (kw && nameLower.includes(kw.toLowerCase())) {
        if (kw.length > maxKwLength) {
          maxKwLength = kw.length;
          bestMatch = cat;
        }
      }
    }
  }

  return bestMatch;
}

// ============================================================================
// 6. 极速记账 DSL 核心编译器主函数
// ============================================================================

/**
 * 极速公式与自然语言解析器（Quick-Parse Input DSL Compiler）
 * 支持算式自含立减、跨品类凑单满减、外币预授权消费解析与池/分类/专项标签路由
 *
 * @param rawText 用户在单行记账框输入的原始文本
 * @param context 可选传入自定义分类、预算池、项目标签或外币默认配置
 */
export function parseQuickInputDsl(
  rawText: string,
  context?: DslParserContext
): ParsedDslResult {
  const trimmedText = rawText.trim();
  if (!trimmedText) {
    throw new Error('Empty DSL input text');
  }

  const categories = context?.categories ?? DEFAULT_CATEGORIES;
  const projectTags = context?.projectTags ?? DEFAULT_PROJECT_TAGS;
  const budgetPools = context?.budgetPools;
  const fxHoldRatio = context?.fxConfig?.defaultHoldRatio ?? '1.02';
  const fxCashbackRate = context?.fxConfig?.defaultCashbackRate ?? '0.01';

  // --------------------------------------------------------------------------
  // 常规/专项支出及外币预授权消费解析
  // --------------------------------------------------------------------------
  let working = trimmedText;

  // A. 提取总实付覆盖净额（= 50 或 = 50.00）
  let mergedNetOverride: string | null = null;
  const mergedMatch = working.match(/=\s*([\d\.]+)/);
  if (mergedMatch) {
    mergedNetOverride = formatCny(mergedMatch[1]);
    working = working.replace(mergedMatch[0], ' ');
  }

  // B. 容错剥离遗留 @xxx 标记（账户体系已前后端移除，不污染商品备注）
  working = working.replace(/@[^\s+#=]+/g, ' ').trim();

  // C. 提取外币标志与预授权冻结本币金额（支持 $、USD、JPY 等符号与 冻结31.95）
  let isFxDetected = false;
  let originalCurrency = 'CNY';
  let originalAmount: string | null = null;
  let holdAmountCny = '0.00';
  let settlementStatus: SettlementStatus = 'SETTLED';

  if (
    working.includes('$') ||
    /\bUSD\b/i.test(working) ||
    /\bJPY\b/i.test(working) ||
    working.includes('冻结')
  ) {
    isFxDetected = true;
  }

  // 提取冻结本币金额（冻结31.95 或 冻结 31.95）
  const holdMatch = working.match(/冻结\s*([\d\.]+)/);
  if (holdMatch) {
    holdAmountCny = formatCny(holdMatch[1]);
    settlementStatus = 'PENDING_HOLD';
    isFxDetected = true;
    working = working.replace(holdMatch[0], ' ');
  }

  // 提取外币币种与原额（$4.35 或 USD 4.35 或 JPY 6500）
  const dollarMatch = working.match(/\$([\d\.]+)/);
  if (dollarMatch) {
    originalCurrency = 'USD';
    originalAmount = formatCny(dollarMatch[1]);
    isFxDetected = true;
    working = working.replace(dollarMatch[0], ' ');
  } else {
    const fxCodeMatch = working.match(
      /(USD|JPY|EUR|GBP|HKD)\s*([\d\.]+)|([\d\.]+)\s*(USD|JPY|EUR|GBP|HKD)/i
    );
    if (fxCodeMatch) {
      originalCurrency = (fxCodeMatch[1] || fxCodeMatch[4]).toUpperCase();
      const rawAmt = fxCodeMatch[2] || fxCodeMatch[3];
      originalAmount =
        originalCurrency === 'JPY'
          ? roundCny(rawAmt).toFixed(0)
          : formatCny(rawAmt);
      isFxDetected = true;
      working = working.replace(fxCodeMatch[0], ' ');
    }
  }

  if (isFxDetected && originalAmount && holdAmountCny === '0.00') {
    const fxRate = DEFAULT_FX_RATES[originalCurrency] ?? '7.200000';
    holdAmountCny = formatCny(
      roundCny(toDecimal(originalAmount).times(fxRate).times(fxHoldRatio))
    );
    settlementStatus = 'PENDING_HOLD';
  }

  // D. 提取行尾或全局标签（如 #饮食 或 #JLPT_N2考试）
  let globalCategoryId: string | null = null;
  let globalPoolId: string | null = null;
  let globalProjectTagId: string | null = null;

  // E. 拆分子明细项
  // 注意：此处 `+` 用于分隔同一单中的不同子项（区分算式内部加号与子项分隔加号：当 `+` 后面紧跟字母或中文字符时，为子项分隔符！）
  const rawSubItemStrings = working
    .split(/\s*\+\s*(?=[\p{L}\p{Script=Han}])/u)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSubItemStrings.length === 0) {
    throw new Error(`Unable to extract transaction items from: "${rawText}"`);
  }

  interface IntermediateItem {
    name: string;
    rawFormula: string | null;
    gross: string;
    discount: string;
    net: string;
    categoryId: string | null;
    poolId: string | null;
    projectTagId: string | null;
    isPrimary: boolean;
  }

  const parsedItems: IntermediateItem[] = [];

  for (let idx = 0; idx < rawSubItemStrings.length; idx++) {
    let itemStr = rawSubItemStrings[idx];
    let itemCategoryId: string | null = null;
    let itemPoolId: string | null = null;
    let itemProjectTagId: string | null = null;
    let isPrimary = false;

    // 检查是否有主商品标记（* 或 !）
    if (itemStr.startsWith('*') || itemStr.startsWith('!')) {
      isPrimary = true;
      itemStr = itemStr.slice(1).trim();
    }

    // 提取该子项内所有 `#标签`
    const tagMatches = Array.from(itemStr.matchAll(/#([^\s#=]+)/g));
    for (const tm of tagMatches) {
      const resolved = resolveTagOrCategory(
        tm[1],
        categories,
        projectTags,
        budgetPools
      );
      if (resolved.projectTag) {
        itemProjectTagId = resolved.projectTag.id;
        if (!itemPoolId && resolved.projectTag.linked_pool_id) {
          itemPoolId = resolved.projectTag.linked_pool_id;
        }
      }
      if (resolved.budgetPool) {
        itemPoolId = resolved.budgetPool.id;
      }
      if (resolved.category) {
        itemCategoryId = resolved.category.id;
        if (!itemPoolId) {
          itemPoolId = resolved.category.default_pool_id;
        }
      }
      itemStr = itemStr.replace(tm[0], ' ');
    }

    itemStr = itemStr.trim();

    // 如果是最后一个子项且带有标签，同时记录为全局后备标签（用于支持场景 1 的尾部全局标签）
    if (idx === rawSubItemStrings.length - 1) {
      if (itemCategoryId) {
        globalCategoryId = itemCategoryId;
      }
      if (itemPoolId) {
        globalPoolId = itemPoolId;
      }
      if (itemProjectTagId) {
        globalProjectTagId = itemProjectTagId;
      }
    }

    // 场景 3 兼容：外币交易且前面已识别外币原额，此时剩余字符串为纯商品名称（如 `Porkbun域名`）
    if (isFxDetected && originalAmount && rawSubItemStrings.length === 1) {
      const name = itemStr.trim() || '外币消费';
      parsedItems.push({
        name,
        rawFormula:
          originalCurrency === 'USD'
            ? `$${originalAmount}`
            : `${originalCurrency} ${originalAmount}`,
        gross: '0.00',
        discount: '0.00',
        net: '0.00',
        categoryId: itemCategoryId,
        poolId: itemPoolId,
        projectTagId: itemProjectTagId,
        isPrimary: true,
      });
      continue;
    }

    // 分离商品名称与数学公式/金额
    // 匹配如 `咸蛋黄拌面 16.8-0.15`、`饭卡充值 20-1.08*3`、`牛奶 28`、`华莱士 19.9`
    const formulaMatch = itemStr.match(
      /^(.*?)\s*([\d\.\+\-\*\/\(\)]+(?:\s*[\+\-\*\/]\s*[\d\.\+\-\*\/\(\)]+)*)$/
    );

    let name = itemStr;
    let formula: string | null = null;

    if (formulaMatch && formulaMatch[2]) {
      name = formulaMatch[1].trim() || '商品支出';
      formula = formulaMatch[2].trim();
    }

    if (!formula) {
      // 容错提取任意结尾数字
      const fallbackNumMatch = itemStr.match(/(.*?)\s*([\d\.]+)$/);
      if (fallbackNumMatch) {
        name = fallbackNumMatch[1].trim() || '商品支出';
        formula = fallbackNumMatch[2].trim();
      } else {
        throw new Error(
          `Unable to parse price formula for item "${itemStr}" in: "${rawText}"`
        );
      }
    }

    const evaluated = evaluateMathFormula(formula);

    parsedItems.push({
      name,
      rawFormula: formula,
      gross: evaluated.gross,
      discount: evaluated.discount,
      net: evaluated.net,
      categoryId: itemCategoryId,
      poolId: itemPoolId,
      projectTagId: itemProjectTagId,
      isPrimary,
    });
  }

  // 补齐分类与预算池（继承尾部全局标签、专项项目标签关联池、名称关键词自动归类）
  for (const item of parsedItems) {
    if (!item.categoryId && globalCategoryId) {
      item.categoryId = globalCategoryId;
    }
    if (!item.poolId && globalPoolId) {
      item.poolId = globalPoolId;
    }
    if (!item.projectTagId && globalProjectTagId) {
      item.projectTagId = globalProjectTagId;
    }

    // 若专项标签绑定默认池且未显式指定分类，优先沿用关联池并在考证标签下自动匹配考证分类
    if (!item.categoryId && item.projectTagId) {
      const pt = projectTags.find((p) => p.id === item.projectTagId);
      if (pt?.id === 'TAG_JLPT_N2') {
        item.categoryId = 'CAT_EXAM_CERT';
      }
      if (!item.poolId && pt?.linked_pool_id) {
        item.poolId = pt.linked_pool_id;
      }
    }

    // 若依然未指定分类，通过商品名称关键词库自动归类（如 华莱士 -> CAT_FOOD, 塔斯汀 -> CAT_FOOD）
    if (!item.categoryId) {
      const matchedCat = autoMatchCategoryByItemName(item.name, categories);
      if (matchedCat) {
        item.categoryId = matchedCat.id;
        if (!item.poolId) {
          item.poolId = matchedCat.default_pool_id;
        }
      } else {
        // 兜底为日常餐饮高频池
        item.categoryId = 'CAT_FOOD';
        if (!item.poolId) {
          item.poolId = 'POOL_DAILY';
        }
      }
    }

    if (!item.poolId) {
      const cat = categories.find((c) => c.id === item.categoryId);
      item.poolId = cat?.default_pool_id ?? 'POOL_DAILY';
    }
  }

  // --------------------------------------------------------------------------
  // 场景 3 计算引擎：万事达外币预授权消费状态机
  // --------------------------------------------------------------------------
  if (isFxDetected && holdAmountCny !== '0.00' && originalAmount) {
    const fxResult = processMastercardFxLifecycle({
      foreignAmount: originalAmount,
      holdAmountCny,
      holdRatio: fxHoldRatio,
      cashbackRate: fxCashbackRate,
    });

    const item = parsedItems[0];
    item.gross = fxResult.total_gross;
    item.discount = fxResult.payment_discount;
    item.net = fxResult.total_net;
    item.isPrimary = true;

    const finalItems: ParsedDslItemResult[] = [
      {
        item_name: item.name,
        category_id: item.categoryId!,
        budget_pool_id: item.poolId!,
        project_tag_id: item.projectTagId,
        item_gross: fxResult.total_gross,
        allocated_discount: fxResult.payment_discount,
        item_net: fxResult.total_net,
        is_primary_item: true,
        raw_formula_expr: item.rawFormula,
      },
    ];

    return {
      tx_type: 'EXPENSE',
      total_gross: fxResult.total_gross,
      platform_discount: '0.00',
      payment_discount: fxResult.payment_discount,
      total_net: fxResult.total_net,
      allocation_mode: 'SINGLE',
      original_currency: originalCurrency,
      original_amount: originalAmount,
      exchange_rate: fxResult.exchange_rate,
      settlement_status: 'PENDING_HOLD',
      hold_amount_cny: holdAmountCny,
      fx_cashback_rate: fxCashbackRate,
      is_fx_detected: true,
      items: finalItems,
      raw_input_text: rawText,
      merchant_or_note: item.name,
    };
  }

  // --------------------------------------------------------------------------
  // 场景 2：跨品类凑单信用卡满减（存在 `= 50` 尾部实付覆盖）
  // --------------------------------------------------------------------------
  if (mergedNetOverride) {
    const totalGrossDec = roundCny(
      parsedItems.reduce(
        (acc, it) => acc.plus(toDecimal(it.gross)),
        new Decimal(0)
      )
    );
    const totalNetDec = roundCny(mergedNetOverride);
    const totalDiscountDec = roundCny(totalGrossDec.minus(totalNetDec));

    // 调用 allocation 核心模块执行等比分摊
    const splitInputs: SplitItemInput[] = parsedItems.map((it) => ({
      name: it.name,
      gross: it.gross,
      category_id: it.categoryId!,
      budget_pool_id: it.poolId!,
      project_tag_id: it.projectTagId,
      is_primary: it.isPrimary,
    }));

    const hasPrimary = parsedItems.some((it) => it.isPrimary);
    const mode: AllocationMode = hasPrimary ? 'PRIMARY_ITEM' : 'PROPORTIONAL';

    const allocated = allocateSplitDiscounts(
      splitInputs,
      totalNetDec,
      mode
    );

    const finalItems: ParsedDslItemResult[] = parsedItems.map((it, idx) => ({
      item_name: it.name,
      category_id: it.categoryId!,
      budget_pool_id: it.poolId!,
      project_tag_id: it.projectTagId,
      item_gross: allocated[idx].gross,
      allocated_discount: allocated[idx].allocated_discount,
      item_net: allocated[idx].net,
      is_primary_item: it.isPrimary,
      raw_formula_expr: it.rawFormula,
    }));

    const note = parsedItems.map((it) => it.name).join(' + ');

    return {
      tx_type: 'EXPENSE',
      total_gross: formatCny(totalGrossDec),
      platform_discount: '0.00',
      payment_discount: formatCny(totalDiscountDec),
      total_net: formatCny(totalNetDec),
      allocation_mode: mode,
      original_currency: originalCurrency,
      original_amount: originalAmount,
      exchange_rate: '1.000000',
      settlement_status: settlementStatus,
      hold_amount_cny: holdAmountCny,
      is_fx_detected: isFxDetected,
      items: finalItems,
      raw_input_text: rawText,
      merchant_or_note: note,
    };
  }

  // --------------------------------------------------------------------------
  // 场景 1 及单品/多品常规录入（无 `= 50` 尾部覆盖，基于各子项算式自含立减）
  // --------------------------------------------------------------------------
  const totalGrossDec = roundCny(
    parsedItems.reduce(
      (acc, it) => acc.plus(toDecimal(it.gross)),
      new Decimal(0)
    )
  );
  const totalItemDiscountDec = roundCny(
    parsedItems.reduce(
      (acc, it) => acc.plus(toDecimal(it.discount)),
      new Decimal(0)
    )
  );
  const totalNetDec = roundCny(totalGrossDec.minus(totalItemDiscountDec));

  const allocationMode: AllocationMode =
    parsedItems.length === 1 ? 'SINGLE' : 'MANUAL';

  const finalItems: ParsedDslItemResult[] = parsedItems.map((it) => ({
    item_name: it.name,
    category_id: it.categoryId!,
    budget_pool_id: it.poolId!,
    project_tag_id: it.projectTagId,
    item_gross: it.gross,
    allocated_discount: it.discount,
    item_net: it.net,
    is_primary_item: parsedItems.length === 1 ? true : it.isPrimary,
    raw_formula_expr: it.rawFormula,
  }));

  const note = parsedItems.map((it) => it.name).join(' + ');

  return {
    tx_type: 'EXPENSE',
    total_gross: formatCny(totalGrossDec),
    platform_discount: formatCny(totalItemDiscountDec),
    payment_discount: '0.00',
    total_net: formatCny(totalNetDec),
    allocation_mode: allocationMode,
    original_currency: originalCurrency,
    original_amount: originalAmount,
    exchange_rate: '1.000000',
    settlement_status: settlementStatus,
    hold_amount_cny: holdAmountCny,
    is_fx_detected: isFxDetected,
    items: finalItems,
    raw_input_text: rawText,
    merchant_or_note: note,
  };
}
