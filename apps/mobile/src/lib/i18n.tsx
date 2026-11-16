import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ur';

const ur: Record<string, string> = {
  'Khidmat': 'خدمت',
  'services': 'خدمات',
  'Sign in with your mobile number': 'اپنے موبائل نمبر سے سائن ان کریں',
  'Mobile number': 'موبائل نمبر',
  'Send code': 'کوڈ بھیجیں',
  'We sent a 6-digit code to': 'ہم نے 6 ہندسوں کا کوڈ بھیجا ہے',
  'Code': 'کوڈ',
  'Sign in': 'سائن ان',
  'Change number': 'نمبر تبدیل کریں',
  'What do you need?': 'آپ کو کیا چاہیے؟',
  'Your location': 'آپ کا مقام',
  'Change': 'تبدیل کریں',
  'Use my location': 'میرا مقام استعمال کریں',
  'Choose my area': 'اپنا علاقہ منتخب کریں',
  'Search area, e.g. G-10 or Satellite Town': 'علاقہ تلاش کریں، مثلاً جی ٹین یا سیٹلائٹ ٹاؤن',
  'Location is off. Choose your area from the list instead.': 'مقام بند ہے۔ اس کے بجائے فہرست سے اپنا علاقہ منتخب کریں۔',
  'We do not serve this area yet': 'ہم ابھی اس علاقے میں سروس فراہم نہیں کرتے',
  'Areas we serve nearby:': 'قریب کے علاقے جہاں ہم سروس دیتے ہیں:',
  'My bookings': 'میری بکنگز',
  'Book': 'بک کریں',
  'Fixed price': 'مقررہ قیمت',
  'Inspection fee': 'معائنہ فیس',
  'Price after inspection': 'قیمت معائنے کے بعد',
  'Details': 'تفصیلات',
  'House, street and block': 'مکان، گلی اور بلاک',
  'Nearby landmark (optional)': 'قریبی نشانی (اختیاری)',
  'When?': 'کب؟',
  'Today, as soon as possible': 'آج، جتنی جلدی ممکن ہو',
  'Choose a time': 'وقت منتخب کریں',
  'Tomorrow': 'کل',
  'Day after': 'پرسوں',
  'Photos and voice note (optional)': 'تصاویر اور صوتی پیغام (اختیاری)',
  'Add photo': 'تصویر شامل کریں',
  'Record voice note': 'صوتی پیغام ریکارڈ کریں',
  'Stop recording': 'ریکارڈنگ بند کریں',
  'Voice note added': 'صوتی پیغام شامل ہو گیا',
  'Where to? (pickup is your location above)': 'کہاں جانا ہے؟ (پک اپ اوپر والا مقام ہے)',
  'Destination area': 'منزل کا علاقہ',
  'Destination address': 'منزل کا پتہ',
  'Review': 'جائزہ',
  'Labour': 'مزدوری',
  'Travel charge': 'سفری چارج',
  'Total now': 'ابھی کی کل رقم',
  'Pay the provider in cash after the work. Any extra cost needs your approval first.': 'کام کے بعد کاریگر کو نقد ادائیگی کریں۔ کسی بھی اضافی خرچ کے لیے پہلے آپ کی منظوری ضروری ہے۔',
  'Confirm booking': 'بکنگ کی تصدیق کریں',
  'No connection. Your booking is saved on this phone.': 'انٹرنیٹ نہیں ہے۔ آپ کی بکنگ اس فون میں محفوظ ہے۔',
  'Send again': 'دوبارہ بھیجیں',
  'You have a booking that was not sent': 'آپ کی ایک بکنگ نہیں بھیجی جا سکی',
  'Discard': 'ختم کریں',
  'Booking confirmed': 'بکنگ کی تصدیق ہو گئی',
  'Requested': 'درخواست بھیج دی گئی',
  'Assigned': 'کاریگر مقرر',
  'On the way': 'راستے میں',
  'On site': 'پہنچ گیا',
  'Awaiting approval': 'آپ کی منظوری کا انتظار',
  'In progress': 'کام جاری',
  'Completed': 'مکمل',
  'Closed': 'بند',
  'Cancelled': 'منسوخ',
  'No provider': 'کاریگر دستیاب نہیں',
  'New price to approve': 'منظوری کے لیے نئی قیمت',
  'Approve': 'منظور کریں',
  'Decline': 'مسترد کریں',
  'Your provider': 'آپ کا کاریگر',
  'Receipt': 'رسید',
  'Materials and parts': 'سامان اور پرزے',
  'Visit and travel': 'وزٹ اور سفر',
  'Tolls and parking': 'ٹول اور پارکنگ',
  'Total': 'کل',
  'Refunded': 'واپس کی گئی رقم',
  'I paid in cash': 'میں نے نقد ادائیگی کر دی',
  'Rate the work': 'کام کی درجہ بندی کریں',
  'Send rating': 'درجہ بندی بھیجیں',
  'Report a problem': 'مسئلہ رپورٹ کریں',
  'What went wrong?': 'کیا مسئلہ ہوا؟',
  'Send complaint': 'شکایت بھیجیں',
  'Cancel booking': 'بکنگ منسوخ کریں',
  'Reason for cancelling': 'منسوخی کی وجہ',
  'No bookings yet': 'ابھی کوئی بکنگ نہیں',
  'Book a service from the home screen.': 'ہوم اسکرین سے سروس بک کریں۔',
  'Sign out': 'سائن آؤٹ',
  'We could not find a provider for this time. Call us or choose another time.': 'اس وقت کے لیے کاریگر نہیں ملا۔ ہمیں کال کریں یا دوسرا وقت منتخب کریں۔',
  'Retry': 'دوبارہ کوشش کریں',
  'Quality': 'معیار',
  'Price': 'قیمت',
  'Behaviour': 'رویہ',
  'Damage': 'نقصان',
  'Did not come': 'نہیں آیا',
  'Other': 'دیگر',
  'Some photos could not be uploaded. The booking is saved.': 'کچھ تصاویر اپ لوڈ نہیں ہو سکیں۔ بکنگ محفوظ ہے۔',
};

const Ctx = createContext<{ lang: Lang; rtl: boolean; setLang: (l: Lang) => void; t: (s: string) => string }>({
  lang: 'en', rtl: false, setLang: () => undefined, t: (s) => s,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const deviceLang: Lang = getLocales()[0]?.languageCode === 'ur' ? 'ur' : 'en';
  const [lang, setLangState] = useState<Lang>(deviceLang);
  useEffect(() => { void AsyncStorage.getItem('khidmat_lang').then((l) => { if (l === 'en' || l === 'ur') setLangState(l); }); }, []);
  const setLang = (l: Lang) => { setLangState(l); void AsyncStorage.setItem('khidmat_lang', l); };
  const t = (s: string) => (lang === 'ur' ? ur[s] ?? s : s);
  return <Ctx.Provider value={{ lang, rtl: lang === 'ur', setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

export function useName() {
  const { lang } = useI18n();
  return (o: Record<string, any> | null | undefined, base = 'name'): string => (o ? o[`${base}_${lang}`] ?? o[`${base}_en`] ?? '' : ''); // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested', assigned: 'Assigned', en_route: 'On the way', on_site: 'On site', awaiting_approval: 'Awaiting approval',
  in_progress: 'In progress', completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled', no_provider: 'No provider',
};
