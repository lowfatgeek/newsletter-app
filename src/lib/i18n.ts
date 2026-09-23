export type Locale = "id" | "en";

const dict = {
  overline: { id: "BAYAR DENGAN DOA", en: "PAY WITH A PRAYER" },
  reflectionHeading: {
    id: "Baca dulu buat unlock",
    en: "Read first to unlock",
  },
  tabMuslim: { id: "Doa Muslim", en: "Muslim Prayer" },
  tabUniversal: { id: "Harapan Baik", en: "Kind Wish" },
  timerInitial: {
    id: "Unlock setelah 30 detik. Baca doa dulu.",
    en: "Unlocks in 30 seconds. Read the prayer first.",
  },
  timerDone: {
    id: "Terima kasih sudah meluangkan waktu. Sekarang, masukkan emailmu.",
    en: "Thanks for taking a moment. Now, enter your email.",
  },
  timerTenLeft: { id: "10 detik lagi.", en: "10 seconds left." },
  timerTooFast: {
    id: "Mohon tunggu timer selesai ya.",
    en: "Please wait for the timer to finish.",
  },
  emailLabel: { id: "Email untuk menerima hadiah", en: "Email to receive your gift" },
  errorEmailInvalid: {
    id: "Format email belum benar. Contoh: nama@gmail.com",
    en: "That email format doesn't look right. Example: name@gmail.com",
  },
  consentCopy: {
    id: "Dengan mengklaim hadiah, kamu juga mendaftar ke newsletter KelasWFA. Lihat",
    en: "By claiming this gift you also subscribe to the KelasWFA newsletter. See the",
  },
  privacyLink: { id: "kebijakan privasi", en: "privacy policy" },
  consentResubscribe: {
    id: "Saya bersedia kembali menerima newsletter dan update materi dari KelasWFA.",
    en: "I agree to receive KelasWFA newsletter and updates again.",
  },
  submittingCta: { id: "Mengirim...", en: "Sending..." },
  submitCta: { id: "KIRIM LINK DOWNLOAD", en: "SEND DOWNLOAD LINK" },
  errorDomain: {
    id: "Domain email ini belum didukung. Coba email lain ya.",
    en: "This email domain is not supported yet. Try another email.",
  },
  errorRate: {
    id: "Terlalu banyak percobaan. Coba lagi beberapa saat.",
    en: "Too many attempts. Please try again shortly.",
  },
  errorGeneric: {
    id: "Terjadi kesalahan. Coba lagi ya.",
    en: "Something went wrong. Please try again.",
  },
  checkEmailTitle: { id: "Cek emailmu", en: "Check your email" },
  checkEmailBody: {
    id: "Kami sudah mengirim tautan ke emailmu. Buka email dari KelasWFA, lalu klik tautannya.",
    en: "We sent a link to your email. Open the KelasWFA email and click the link.",
  },
  checkEmailErrorTitle: {
    id: "Permintaan belum dapat diproses",
    en: "Request could not be processed",
  },
  checkEmailErrorBody: {
    id: "Tautan akses belum dapat dikirimkan. Silakan periksa keterangan di bawah dan coba lagi.",
    en: "The access link could not be sent. Please check the note below and try again.",
  },
  itemFormat: { id: "Format", en: "Format" },
  itemSize: { id: "Ukuran", en: "Size" },
  skipToForm: { id: "Lewati ke form klaim", en: "Skip to the claim form" },
  downloadCta: { id: "Download Kado", en: "Download Gift" },
  downloadSubtext: {
    id: "Cukup bayar dengan doa dan link akan dikirim via email",
    en: "Simply pay with a prayer and the link will be sent to your email",
  },
  stepTakeMoment: {
    id: "Langkah 1: Luangkan Waktu Sejenak",
    en: "Step 1: Take A Quiet Moment",
  },
  closeModal: { id: "Tutup modal", en: "Close modal" },
} as const;

export type I18nKey = keyof typeof dict;

export function t(locale: Locale, key: I18nKey): string {
  return dict[key][locale];
}
