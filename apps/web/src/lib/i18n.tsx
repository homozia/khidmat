import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ur';

/** UI strings. Catalogue names (jobs, categories, zones) come from the API in both languages. */
const ur: Record<string, string> = {
  'Sign in': 'سائن ان',
  'Mobile number': 'موبائل نمبر',
  'Send code': 'کوڈ بھیجیں',
  'Enter the 6-digit code': '6 ہندسوں کا کوڈ درج کریں',
  'Verify and sign in': 'تصدیق کریں اور سائن ان کریں',
  'Use a different number': 'دوسرا نمبر استعمال کریں',
  'Sign out': 'سائن آؤٹ',
  'Offers': 'پیشکشیں',
  'My jobs': 'میرے کام',
  'Earnings': 'کمائی',
  'Profile': 'پروفائل',
  'Accept': 'قبول کریں',
  'Decline': 'مسترد کریں',
  'No offers right now': 'اس وقت کوئی پیشکش نہیں',
  'New offers appear here. Keep "Accepting jobs" on in your profile.': 'نئی پیشکشیں یہاں نظر آئیں گی۔ پروفائل میں "کام قبول کر رہا ہوں" آن رکھیں۔',
  'Offer expires': 'پیشکش ختم ہوگی',
  'Address is shown after you accept.': 'پتہ قبول کرنے کے بعد دکھایا جائے گا۔',
  'No jobs yet': 'ابھی کوئی کام نہیں',
  'Accepted jobs appear here.': 'قبول کیے گئے کام یہاں نظر آئیں گے۔',
  'On my way': 'راستے میں ہوں',
  'I have arrived': 'میں پہنچ گیا ہوں',
  'Start work': 'کام شروع کریں',
  'Send price for approval': 'منظوری کے لیے قیمت بھیجیں',
  'Add line': 'لائن شامل کریں',
  'Description': 'تفصیل',
  'Type': 'قسم',
  'Quantity': 'تعداد',
  'Price (PKR)': 'قیمت (روپے)',
  'Labour': 'مزدوری',
  'Materials and parts': 'سامان اور پرزے',
  'Driver hours': 'ڈرائیور کے گھنٹے',
  'Overtime': 'اوور ٹائم',
  'Tolls and parking': 'ٹول اور پارکنگ',
  'Waiting for the customer to approve': 'گاہک کی منظوری کا انتظار',
  'Complete and record cash': 'کام مکمل کریں اور نقد رقم درج کریں',
  'Cash collected (PKR)': 'وصول شدہ نقد (روپے)',
  'Customer total': 'گاہک کی کل رقم',
  'Platform fee': 'پلیٹ فارم فیس',
  'Your earnings': 'آپ کی کمائی',
  'Amount you owe': 'آپ کے ذمے رقم',
  'Weekly statements': 'ہفتہ وار گوشوارے',
  'Accepting jobs': 'کام قبول کر رہا ہوں',
  'Skills': 'مہارتیں',
  'Areas': 'علاقے',
  'Documents': 'دستاویزات',
  'Upload document': 'دستاویز اپ لوڈ کریں',
  'Add completion photo': 'کام مکمل ہونے کی تصویر',
  'Customer': 'گاہک',
  'Address': 'پتہ',
  'Landmark': 'نشانی',
  'Call': 'کال کریں',
  'Back': 'واپس',
  'Save': 'محفوظ کریں',
  'Something went wrong. Please try again.': 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔',
  'approved': 'منظور شدہ',
  'pending': 'زیر غور',
  'rejected': 'مسترد',
  'Requested': 'درخواست',
  'Assigned': 'تفویض',
  'On the way': 'راستے میں',
  'On site': 'موقع پر',
  'Awaiting approval': 'منظوری کا انتظار',
  'In progress': 'کام جاری',
  'Completed': 'مکمل',
  'Closed': 'بند',
  'Cancelled': 'منسوخ',
  'No provider': 'کوئی کاریگر نہیں',
  'Language': 'زبان',
  'Destination': 'منزل',
  'Time': 'وقت',
  'Reference': 'حوالہ نمبر',
  'Open directions': 'راستہ دیکھیں',
  'Prices': 'قیمتیں',
  'Note for the customer': 'گاہک کے لیے نوٹ',
};

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string }>({
  lang: 'en', setLang: () => undefined, t: (s) => s,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try { return (localStorage.getItem('khidmat.lang') as Lang) || 'en'; } catch { return 'en'; }
  });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
    try { localStorage.setItem('khidmat.lang', lang); } catch { /* ignore */ }
  }, [lang]);
  const t = (s: string) => (lang === 'ur' ? ur[s] ?? s : s);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

/** Picks the Urdu or English field of an API object: name(o) -> o.name_ur or o.name_en */
export function useName() {
  const { lang } = useI18n();
  return (o: Record<string, unknown> | null | undefined, base = 'name') =>
    (o ? (o[`${base}_${lang}`] ?? o[`${base}_en`] ?? '') : '') as string;
}

export const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested', assigned: 'Assigned', en_route: 'On the way', on_site: 'On site', awaiting_approval: 'Awaiting approval',
  in_progress: 'In progress', completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled', no_provider: 'No provider',
};
