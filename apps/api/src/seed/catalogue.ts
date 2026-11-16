/**
 * Launch catalogue: 11 categories and their initial bookable jobs.
 * Prices are DEMO values for local testing only; operators set real prices in the admin dashboard.
 */

export type Mode = 'fixed' | 'quote' | 'inspection';

export interface SeedField {
  key: string;
  type: 'integer' | 'text' | 'select' | 'boolean' | 'hours';
  en: string;
  ur: string;
  required?: boolean;
  min?: number;
  max?: number;
}

export interface SeedJob {
  code: string;
  en: string;
  ur: string;
  modes: Mode[];
  /** PKR, demo */
  labour?: number;
  /** PKR per extra unit beyond `included` */
  unit?: { key: string; label: string; price: number; included: number };
  inspection?: number;
  duration?: number;
  destination?: boolean;
  fields?: SeedField[];
}

export interface SeedCategory {
  code: string;
  en: string;
  ur: string;
  skill: { code: string; en: string; ur: string; restricted: boolean };
  jobs: SeedJob[];
}

const details: SeedField = { key: 'problem_details', type: 'text', en: 'Describe the problem', ur: 'مسئلہ بیان کریں' };
const count = (key: string, en: string, ur: string, max = 20): SeedField => ({ key, type: 'integer', en, ur, required: true, min: 1, max });
const hours = (min = 2, max = 12): SeedField => ({ key: 'hours', type: 'hours', en: 'Hours needed', ur: 'کتنے گھنٹے', required: true, min, max });

export const CATALOGUE: SeedCategory[] = [
  {
    code: 'plumbing', en: 'Plumbing', ur: 'پلمبنگ',
    skill: { code: 'plumbing', en: 'Plumbing', ur: 'پلمبنگ', restricted: false },
    jobs: [
      { code: 'plumbing.tap_leak', en: 'Tap and pipe leak repair', ur: 'نل اور پائپ کے رساؤ کی مرمت', modes: ['fixed'], labour: 800,
        unit: { key: 'taps', label: 'tap', price: 400, included: 1 }, fields: [count('taps', 'Number of taps or leak points', 'نلوں یا رساؤ کی تعداد', 10)] },
      { code: 'plumbing.drain_block', en: 'Blocked drain clearing', ur: 'بند نالی کھولنا', modes: ['fixed'], labour: 1200 },
      { code: 'plumbing.toilet_flush', en: 'Toilet flush repair', ur: 'فلش کی مرمت', modes: ['fixed'], labour: 1000 },
      { code: 'plumbing.sanitary_install', en: 'Sanitary fitting installation', ur: 'سینیٹری فٹنگ کی تنصیب', modes: ['fixed'], labour: 1500,
        unit: { key: 'items', label: 'fitting', price: 1500, included: 1 }, fields: [count('items', 'Number of fittings', 'فٹنگز کی تعداد')] },
      { code: 'plumbing.water_pump', en: 'Water pump diagnosis', ur: 'واٹر پمپ کی جانچ', modes: ['inspection'], inspection: 500, fields: [details] },
    ],
  },
  {
    code: 'electrical', en: 'Electrical work', ur: 'بجلی کا کام',
    skill: { code: 'electrical', en: 'Electrician', ur: 'الیکٹریشن', restricted: true },
    jobs: [
      { code: 'electrical.light_fan', en: 'Light or fan installation and repair', ur: 'لائٹ یا پنکھے کی تنصیب اور مرمت', modes: ['fixed'], labour: 600,
        unit: { key: 'items', label: 'item', price: 600, included: 1 }, fields: [count('items', 'Number of lights or fans', 'لائٹس یا پنکھوں کی تعداد')] },
      { code: 'electrical.switch_socket', en: 'Switch and socket repair', ur: 'سوئچ اور ساکٹ کی مرمت', modes: ['fixed'], labour: 400,
        unit: { key: 'items', label: 'point', price: 400, included: 1 }, fields: [count('items', 'Number of switches or sockets', 'سوئچ یا ساکٹ کی تعداد')] },
      { code: 'electrical.wiring_fault', en: 'Wiring fault diagnosis', ur: 'وائرنگ کی خرابی کی جانچ', modes: ['inspection'], inspection: 600, fields: [details] },
      { code: 'electrical.breaker', en: 'Circuit breaker repair', ur: 'سرکٹ بریکر کی مرمت', modes: ['inspection'], inspection: 600, fields: [details] },
    ],
  },
  {
    code: 'carpentry', en: 'Carpentry and furniture repair', ur: 'بڑھئی اور فرنیچر کی مرمت',
    skill: { code: 'carpentry', en: 'Carpenter', ur: 'بڑھئی', restricted: false },
    jobs: [
      { code: 'carpentry.door_hinge', en: 'Door and hinge repair', ur: 'دروازے اور قبضے کی مرمت', modes: ['fixed'], labour: 900 },
      { code: 'carpentry.drawer_cabinet', en: 'Drawer and cabinet repair', ur: 'دراز اور الماری کی مرمت', modes: ['fixed'], labour: 800 },
      { code: 'carpentry.furniture_assembly', en: 'Furniture assembly', ur: 'فرنیچر جوڑنا', modes: ['fixed'], labour: 1500,
        unit: { key: 'items', label: 'item', price: 1500, included: 1 }, fields: [count('items', 'Number of items', 'اشیاء کی تعداد')] },
      { code: 'carpentry.custom_woodwork', en: 'Custom woodwork quote', ur: 'خصوصی لکڑی کے کام کا تخمینہ', modes: ['quote'], fields: [details] },
    ],
  },
  {
    code: 'painting', en: 'Painting and wall repair', ur: 'پینٹ اور دیوار کی مرمت',
    skill: { code: 'painting', en: 'Painter', ur: 'پینٹر', restricted: false },
    jobs: [
      { code: 'painting.room', en: 'Room painting', ur: 'کمرے کا پینٹ', modes: ['inspection'], inspection: 500,
        fields: [count('rooms', 'Number of rooms', 'کمروں کی تعداد', 10)] },
      { code: 'painting.doors_railings', en: 'Doors and railings painting', ur: 'دروازوں اور جنگلوں کا پینٹ', modes: ['quote'], fields: [details] },
      { code: 'painting.crack_putty', en: 'Crack patching and putty', ur: 'دراڑ بھرائی اور پٹی', modes: ['inspection'], inspection: 500, fields: [details] },
      { code: 'painting.whole_property', en: 'Whole-property painting quote', ur: 'پورے گھر کے پینٹ کا تخمینہ', modes: ['inspection'], inspection: 1000, fields: [details] },
    ],
  },
  {
    code: 'ac', en: 'AC service and installation', ur: 'اے سی سروس اور تنصیب',
    skill: { code: 'ac_technician', en: 'AC technician', ur: 'اے سی ٹیکنیشن', restricted: false },
    jobs: [
      { code: 'ac.cleaning', en: 'Split AC cleaning', ur: 'اسپلٹ اے سی کی صفائی', modes: ['fixed'], labour: 2500,
        unit: { key: 'units', label: 'AC', price: 2500, included: 1 }, fields: [count('units', 'Number of ACs', 'اے سی کی تعداد', 10)] },
      { code: 'ac.cooling_fault', en: 'Cooling fault diagnosis', ur: 'کولنگ کی خرابی کی جانچ', modes: ['inspection'], inspection: 1000, fields: [details] },
      { code: 'ac.split_install', en: 'Split AC installation', ur: 'اسپلٹ اے سی کی تنصیب', modes: ['fixed'], labour: 4500, duration: 180 },
      { code: 'ac.relocation', en: 'Split AC relocation', ur: 'اسپلٹ اے سی کی منتقلی', modes: ['fixed'], labour: 6500, duration: 240 },
    ],
  },
  {
    code: 'appliance', en: 'Home appliance repair', ur: 'گھریلو آلات کی مرمت',
    skill: { code: 'appliance_technician', en: 'Appliance technician', ur: 'آلات کا ٹیکنیشن', restricted: false },
    jobs: [
      { code: 'appliance.fridge', en: 'Refrigerator repair', ur: 'فریج کی مرمت', modes: ['inspection'], inspection: 800, fields: [details] },
      { code: 'appliance.washing_machine', en: 'Washing machine repair', ur: 'واشنگ مشین کی مرمت', modes: ['inspection'], inspection: 800, fields: [details] },
      { code: 'appliance.microwave', en: 'Microwave repair', ur: 'مائیکرو ویو کی مرمت', modes: ['inspection'], inspection: 600, fields: [details] },
      { code: 'appliance.dispenser', en: 'Water dispenser repair', ur: 'واٹر ڈسپنسر کی مرمت', modes: ['inspection'], inspection: 600, fields: [details] },
    ],
  },
  {
    code: 'cleaning', en: 'Home and office cleaning', ur: 'گھر اور دفتر کی صفائی',
    skill: { code: 'cleaning', en: 'Cleaner', ur: 'صفائی کا عملہ', restricted: false },
    jobs: [
      { code: 'cleaning.kitchen', en: 'Kitchen cleaning', ur: 'کچن کی صفائی', modes: ['fixed'], labour: 3000, duration: 180 },
      { code: 'cleaning.bathroom', en: 'Bathroom cleaning', ur: 'باتھ روم کی صفائی', modes: ['fixed'], labour: 1500,
        unit: { key: 'bathrooms', label: 'bathroom', price: 1500, included: 1 }, fields: [count('bathrooms', 'Number of bathrooms', 'باتھ رومز کی تعداد', 8)] },
      { code: 'cleaning.floors', en: 'Floor cleaning', ur: 'فرش کی صفائی', modes: ['fixed'], labour: 2500 },
      { code: 'cleaning.deep', en: 'Deep cleaning', ur: 'گہری صفائی', modes: ['quote'], fields: [details] },
      { code: 'cleaning.sofa_carpet', en: 'Sofa and carpet cleaning', ur: 'صوفہ اور قالین کی صفائی', modes: ['fixed'], labour: 700,
        unit: { key: 'seats', label: 'seat', price: 700, included: 1 }, fields: [count('seats', 'Sofa seats', 'صوفے کی نشستیں', 30)] },
      { code: 'cleaning.move_in_out', en: 'Move-in and move-out cleaning', ur: 'نئے یا پرانے گھر کی مکمل صفائی', modes: ['quote'], fields: [details] },
    ],
  },
  {
    code: 'handyman', en: 'Handyman and installation', ur: 'ہینڈی مین اور تنصیب',
    skill: { code: 'handyman', en: 'Handyman', ur: 'ہینڈی مین', restricted: false },
    jobs: [
      { code: 'handyman.tv_bracket', en: 'TV bracket installation', ur: 'ٹی وی بریکٹ کی تنصیب', modes: ['fixed'], labour: 1500 },
      { code: 'handyman.shelves', en: 'Shelf installation', ur: 'شیلف کی تنصیب', modes: ['fixed'], labour: 600,
        unit: { key: 'items', label: 'shelf', price: 600, included: 1 }, fields: [count('items', 'Number of shelves', 'شیلف کی تعداد')] },
      { code: 'handyman.curtain_rods', en: 'Curtain rod installation', ur: 'پردے کی راڈ کی تنصیب', modes: ['fixed'], labour: 500,
        unit: { key: 'items', label: 'rod', price: 500, included: 1 }, fields: [count('items', 'Number of rods', 'راڈز کی تعداد')] },
      { code: 'handyman.blinds', en: 'Blinds installation', ur: 'بلائنڈز کی تنصیب', modes: ['fixed'], labour: 800,
        unit: { key: 'items', label: 'blind', price: 800, included: 1 }, fields: [count('items', 'Number of blinds', 'بلائنڈز کی تعداد')] },
      { code: 'handyman.mirror', en: 'Mirror installation', ur: 'آئینے کی تنصیب', modes: ['fixed'], labour: 700 },
      { code: 'handyman.minor_repairs', en: 'Minor repairs (hourly)', ur: 'چھوٹی مرمت (فی گھنٹہ)', modes: ['fixed'], labour: 0,
        unit: { key: 'hours', label: 'hour', price: 800, included: 0 }, fields: [hours(1, 6)] },
    ],
  },
  {
    code: 'driver', en: "Driver for the customer's car", ur: 'آپ کی گاڑی کے لیے ڈرائیور',
    skill: { code: 'driver', en: 'Driver (licensed)', ur: 'ڈرائیور (لائسنس یافتہ)', restricted: true },
    jobs: [
      { code: 'driver.hourly', en: 'Hourly driver', ur: 'گھنٹہ وار ڈرائیور', modes: ['fixed'], labour: 0, destination: true,
        unit: { key: 'hours', label: 'hour', price: 600, included: 0 }, fields: [hours()] },
      { code: 'driver.daily', en: 'Full-day driver (10 hours)', ur: 'پورے دن کا ڈرائیور (10 گھنٹے)', modes: ['fixed'], labour: 5000, duration: 600, destination: true },
      { code: 'driver.errands', en: 'Errands and appointments', ur: 'کام کاج اور ملاقاتیں', modes: ['fixed'], labour: 0, destination: true,
        unit: { key: 'hours', label: 'hour', price: 600, included: 0 }, fields: [hours()] },
      { code: 'driver.airport', en: 'Airport trip', ur: 'ایئرپورٹ کا سفر', modes: ['fixed'], labour: 2000, duration: 180, destination: true },
      { code: 'driver.cross_city', en: 'Cross-city trip', ur: 'شہر سے باہر کا سفر', modes: ['fixed'], labour: 0, destination: true,
        unit: { key: 'hours', label: 'hour', price: 600, included: 0 }, fields: [hours()] },
    ],
  },
  {
    code: 'locksmith', en: 'Locksmith', ur: 'تالے کا کام',
    skill: { code: 'locksmith', en: 'Locksmith', ur: 'تالہ ساز', restricted: true },
    jobs: [
      { code: 'locksmith.repair', en: 'Lock repair', ur: 'تالے کی مرمت', modes: ['fixed'], labour: 800 },
      { code: 'locksmith.replace', en: 'Lock replacement', ur: 'تالہ تبدیل کرنا', modes: ['fixed'], labour: 1000 },
      { code: 'locksmith.new_lock', en: 'New lock installation', ur: 'نئے تالے کی تنصیب', modes: ['fixed'], labour: 1200 },
      { code: 'locksmith.lockout', en: 'Authorised lockout assistance', ur: 'بند دروازہ کھولنا (تصدیق کے ساتھ)', modes: ['fixed'], labour: 1500,
        fields: [{ key: 'occupant_confirmed', type: 'boolean', en: 'I live here or am authorised by the occupant', ur: 'میں یہاں رہتا/رہتی ہوں یا مکین کی اجازت ہے', required: true }] },
    ],
  },
  {
    code: 'solar_ups', en: 'Solar and UPS maintenance', ur: 'سولر اور یو پی ایس مینٹیننس',
    skill: { code: 'solar_ups', en: 'Solar and UPS technician', ur: 'سولر اور یو پی ایس ٹیکنیشن', restricted: true },
    jobs: [
      { code: 'solar.panel_cleaning', en: 'Solar panel cleaning', ur: 'سولر پینل کی صفائی', modes: ['fixed'], labour: 0,
        unit: { key: 'panels', label: 'panel', price: 300, included: 0 }, fields: [count('panels', 'Number of solar panels', 'سولر پینلز کی تعداد', 60)] },
      { code: 'solar.output_diagnosis', en: 'Output and inverter diagnosis', ur: 'آؤٹ پٹ اور انورٹر کی جانچ', modes: ['inspection'], inspection: 1500, fields: [details] },
      { code: 'solar.system_inspection', en: 'Solar system inspection', ur: 'سولر سسٹم کا معائنہ', modes: ['inspection'], inspection: 2000 },
      { code: 'solar.ups_diagnosis', en: 'UPS backup and charging diagnosis', ur: 'یو پی ایس بیک اپ اور چارجنگ کی جانچ', modes: ['inspection'], inspection: 800, fields: [details] },
      { code: 'solar.battery', en: 'Battery health check and replacement', ur: 'بیٹری کی جانچ اور تبدیلی', modes: ['inspection'], inspection: 800 },
    ],
  },
];

export const CHARGE_TYPES = [
  { code: 'labour', en: 'Labour', ur: 'مزدوری', commissionable: true, group: 'labour' },
  { code: 'inspection_fee', en: 'Inspection fee', ur: 'معائنہ فیس', commissionable: true, group: 'labour' },
  { code: 'driver_hours', en: 'Driver hours', ur: 'ڈرائیور کے گھنٹے', commissionable: true, group: 'labour' },
  { code: 'overtime', en: 'Overtime', ur: 'اوور ٹائم', commissionable: true, group: 'labour' },
  { code: 'visit_charge', en: 'Visit charge', ur: 'وزٹ چارج', commissionable: true, group: 'visit_travel' },
  { code: 'travel_charge', en: 'Travel charge', ur: 'سفری چارج', commissionable: false, group: 'visit_travel' },
  { code: 'materials', en: 'Materials and parts', ur: 'سامان اور پرزے', commissionable: false, group: 'materials' },
  { code: 'reimbursement', en: 'Tolls and parking', ur: 'ٹول اور پارکنگ', commissionable: false, group: 'reimbursements' },
] as const;
