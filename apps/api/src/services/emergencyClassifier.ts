const emergencyPhrases = [
  'emergency', 'ambulance', 'chest pain', 'heart attack', 'stroke', 'severe bleeding', 'uncontrolled bleeding',
  'difficulty breathing', 'cannot breathe', "can't breathe", 'not breathing', 'shortness of breath', 'unconscious', 'unresponsive',
  'anaphylaxis', 'severe allergic reaction', 'throat is closing', 'overdose', 'poisoning', 'suicide', 'suicidal',
  'self-harm', 'self harm', 'hurt myself', 'kill myself', 'want to die',
  'zyada dose', 'zyada dawa', 'dawa ki zyada miqdaar', 'shadeed allergy', 'gala band', 'saans band',
  'khud ko nuqsan', 'khud ko nuksan', 'khudkushi', 'apni jaan', 'seene mein dard', 'seenay mein dard', 'dil mein dard',
  'falij', 'lakwa', 'bohat zyada khoon beh', 'khoon ruk nahi', 'shadeed khoon beh', 'saans nahi aa rahi',
  'saans lene mein dushwari', 'saans lene mein takleef', 'saans ki takleef', 'dum ghut', 'behosh', 'hosh nahi',
  'زیادہ مقدار', 'دوا کی زیادہ مقدار', 'شدید الرجی', 'گلا بند', 'سانس بند', 'خود کو نقصان', 'خودکشی',
  'اپنی جان', 'سینے میں', 'دل میں درد', 'فالج', 'لقوہ', 'شدید خون بہنا', 'زیادہ خون بہہ', 'خون بند نہیں',
  'سانس نہیں آ رہی', 'سانس لینے میں دشواری', 'سانس لینے میں مشکل', 'بے ہوش', 'ہوش میں نہیں',
];

export function isEmergencyMessage(message: string): boolean {
  const normalized = message.normalize('NFKC').toLocaleLowerCase();
  return emergencyPhrases.some(phrase => normalized.includes(phrase));
}