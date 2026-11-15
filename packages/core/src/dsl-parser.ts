import {
  Category,
  ProjectTag,
  BudgetPool,
  TransactionType,
  AllocationMode,
  SettlementStatus,
  FxPreferenceConfig,
} from './types.js';
import { invokeRustCore } from './wasm-bridge.js';

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
    is_active: true,
  },
  {
    id: 'TAG_MCU_LAB',
    name: '单片机硬件实验',
    tag_type: 'SCENE',
    target_budget: null,
    is_active: true,
  },
  {
    id: 'TAG_STOCK_EAT',
    name: '靠存货/刷饭卡度日',
    tag_type: 'STOCK_CONSUME',
    target_budget: null,
    is_active: true,
  },
];

// ============================================================================
// 2. 常见别名映射表 (分类简写、专项标签)
// ============================================================================

export function evaluateMathFormula(expr: string): {
  gross: string;
  discount: string;
  net: string;
} {
  return invokeRustCore({ op: 'evaluate_math_formula', expr });
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

/**
 * 极速公式与自然语言解析器（Quick-Parse Input DSL Compiler）
 * 委托 Rust WASM 内核执行
 */
export function parseQuickInputDsl(
  rawText: string,
  context?: DslParserContext
): ParsedDslResult {
  return invokeRustCore<ParsedDslResult>({
    op: 'parse_quick_input_dsl',
    rawText,
    context: context ?? null,
  });
}
