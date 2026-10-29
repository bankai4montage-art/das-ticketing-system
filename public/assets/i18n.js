/* DAS Portal — الترجمة الديناميكية (عربي ⇄ إنجليزي)
   القاموس هنا عربي→إنجليزي، والاتجاه العكسي مبني أوتوماتيك من نفس القاموس.
   الترجمة بتحصل على مستوى النص الظاهر في الصفحة، فأي نص بيتولّد بالجافاسكريبت
   (جداول، كروت، توست) بيتحول لوحده كمان — من غير تعديل كل سطر في الكود.
   المستخدم بيكتب بنفسه (وصف الشكوى، ملاحظة الإدارة) — ده بيتسجل بـ data-i18n-raw
   عشان ما يترجمش نص المستخدم بالغلط. */
(function () {
  const DICT = {
    // ===== بوابة المندوب: الدخول =====
    'بوابة دعم المناديب': 'Courier Support Portal',
    'سجّل دخولك بكود الـ DAS الخاص بك': 'Sign in with your DAS code',
    'ادخل كود المندوب': 'Enter your courier code',
    'كود المندوب': 'Courier code',
    'دخول السيستم': 'Sign in',
    'دخول للسيستم': 'Sign in',
    'خطأ في الدخول': 'Sign-in error',
    'تعذر الاتصال بالسيرفر': 'Could not reach the server',

    // ===== الشريط العلوي =====
    'تفعيل الإشعارات': 'Enable notifications',
    'الإشعارات مفعلة': 'Notifications enabled',
    'الإشعارات': 'Notifications',
    'الإشعارات اتقفلت': 'Notifications turned off',
    'الإشعارات اتفتحت — هنبعتلك أي تحديث هنا': 'Notifications are on — every update will be sent here',
    'المتصفح ده مش بيدعم الإشعارات': 'This browser does not support notifications',
    'سمحتيش بالإشعارات — عدّلها من إعدادات المتصفح': 'Notifications were blocked — allow them in your browser settings',
    'فشل تفعيل الإشعارات': 'Failed to enable notifications',
    'تغيير المظهر': 'Change appearance',
    'تغيير اللغة': 'Change language',
    'خروج': 'Sign out',

    // ===== بوابة المندوب: الشاشة الرئيسية =====
    'قيد المراجعة': 'Under review',
    'لازم المكتب': 'Must come to office',
    'اتحلت': 'Resolved',
    'يتم المراجعة': 'Under review',
    'لازم تيجي المكتب': 'Must come to the office',
    'مرفوض بسبب الروستر': 'Rejected due to the roster',
    'مرفوض': 'Rejected',
    'شكواك مرفوضة بسبب بيانات الروستر': 'Your complaint was rejected because of the roster data',
    'اختر القسم لتسجيل شكوى أو طلب': 'Pick a section to file a complaint or a request',
    'الشيفت': 'Shift',
    'تعديل شيفت، غياب، تبديل، حضور': 'Shift edit, absence, swap, attendance',
    'القبض': 'Payroll',
    'خصومات، بونص، تقفيل، حسابات': 'Deductions, bonus, cash closing, accounts',
    'سلفة': 'Advance',
    'سلف': 'Advances',
    'طلب سلفة من القبض — تحويل على محفظتك': 'Request an advance from payroll — sent to your wallet',
    'تسجيل مشكلة': 'Report an issue',
    'تسجيل شكوى بخصوص:': 'Filing a complaint about:',
    'إغلاق': 'Close',
    'نوع المشكلة': 'Issue type',
    'تاريخ اليوم / الشيفت': 'Date of today / shift',
    'اشرح مشكلتك بالتفصيل': 'Describe your issue in detail',
    'اكتب تفاصيل المشكلة هنا بوضوح...': 'Write the issue details clearly here...',
    'إرسال الشكوى للإدارة': 'Send complaint to admin',
    'طلب سلفة': 'Request an advance',
    'المبلغ المطلوب (جنيه)': 'Amount requested (EGP)',
    'رقم المحفظة (فودافون كاش / انستاباي)': 'Wallet number (Vodafone Cash / InstaPay)',
    'سبب السلفة': 'Reason for the advance',
    'اكتب سبب السلفة باختصار...': 'Write the reason briefly...',
    'إرسال طلب السلفة': 'Send advance request',
    'متابعة شكاواك وحالتها': 'Track your complaints and their status',
    'سلفك وحالتها': 'Your advances and their status',
    'تحديث تلقائي': 'Auto refresh',
    'تم إرسال الشكوى للإدارة بنجاح': 'Complaint sent to the admin successfully',
    'فشل إرسال الشكوى، حاول مرة أخرى': 'Failed to send the complaint, try again',
    'تم إرسال طلب السلفة للإدارة': 'Advance request sent to the admin',
    'فشل إرسال الطلب، حاول مرة أخرى': 'Failed to send the request, try again',
    'الإدارة حدّثت إحدى شكاواك': 'Admin updated one of your complaints',
    'الإدارة حدّثت حالة سلفة من سلفك': 'Admin updated one of your advances',
    'مبروك — شكواك اتحلت': 'Congrats — your complaint was resolved',
    'مبروك': 'Congrats',
    'شكاوى اتحلت': 'complaints resolved',
    'بمبلغ': 'for',
    'لا توجد شكاوى حتى الآن': 'No complaints yet',
    'اختر قسم من الأعلى لتسجيل أول شكوى': 'Pick a section above to file your first complaint',
    'لا توجد سلف حتى الآن': 'No advances yet',
    'لو محتاج سلفة اضغط على كارت السلفة فوق': 'Need an advance? Tap the advance card above',
    'المحفظة:': 'Wallet:',
    'رد الإدارة': 'Admin reply',
    'رقم الطلب:': 'Request #:',
    'رقم الطلب': 'Request #',
    'تاريخ المشكلة:': 'Issue date:',
    'تم الإرسال': 'Sent',
    'المراجعة': 'Review',
    'القرار': 'Decision',
    'المكتب': 'Office',

    // ===== بوابة المندوب: subtypes والتقييم =====
    'غياب اتسجل غلط': 'Incorrect absence recorded',
    'طلب تعديل شيفت': 'Shift change request',
    'مشكلة حضور وانصراف': 'Check-in / check-out issue',
    'تبديل شيفت': 'Shift swap',
    'أخرى': 'Other',
    'تعثر الشيكات': 'Returned checks',
    'غلطة قسمة': 'Calculation error',
    'لم يتم الدفع': 'Not paid',
    'مكافأة إضافية': 'Extra bonus',
    'خصم غير مبرر': 'Unjustified deduction',
    'بونص منزلش': 'Missing bonus',
    'مشكلة في التقفيل / عجز': 'Issue with cash closing / shortage',
    'تأخر نزول القبض': 'Late payroll deposit',
    'عدّل تقييمك للحل': 'Edit your rating of the resolution',
    'قيّم الحل': 'Rate the resolution',
    'تعليق (اختياري)': 'Comment (optional)',
    'حفظ التقييم': 'Save rating',
    'تقييمك للحل': 'Your rating',
    'تعديل التقييم': 'Edit rating',
    'اختار نجمة الأول': 'Pick a star first',
    'فشل حفظ التقييم': 'Failed to save the rating',
    'شكرا على تقييمك': 'Thanks for your rating',
    'تقييم': 'rating',
    'تقييمات': 'ratings',

    // ===== لوحة الإدارة: الدخول والرأس =====
    'لوحة تحكم الإدارة': 'Admin control panel',
    'أدخل كلمة مرور الإدارة للمتابعة': 'Enter the admin password to continue',
    'كلمة المرور': 'Password',
    'كلمة المرور غير صحيحة': 'Wrong password',
    'دخول': 'Sign in',
    'صفحة المندوب': 'Courier page',
    'إدارة شكاوى المناديب': 'Courier complaints management',
    'متابعة لحظية لشكاوى الشيفت والقبض': 'Live tracking of shift and payroll complaints',
    'مباشر': 'Live',
    'المناديب': 'Couriers',
    'الشكاوى': 'Complaints',
    'السلف': 'Advances',
    'إجمالي الشكاوى': 'Total complaints',
    'رضا التيم': 'Team satisfaction',
    'متوسط تقييمات المناديب للحلول': 'Average courier rating of the resolutions',
    'نسبة الإنجاز': 'Resolution rate',
    '% اتحلت': '% resolved',

    // ===== لوحة الإدارة: الفلاتر والجداول =====
    'الكل': 'All',
    'كل الفترات': 'All periods',
    'اليوم': 'Today',
    'آخر 7 أيام': 'Last 7 days',
    'هذا الشهر': 'This month',
    'تقييم ضعيف': 'Poor rating',
    'الأرشيف': 'Archive',
    'تصدير CSV': 'Export CSV',
    'تصدير': 'Export',
    'تصدير التقرير': 'Export report',
    'ابحث بكود DAS أو اسم المندوب...': 'Search by DAS code or courier name...',
    'ابحث بكود/اسم/سبب/محفظة...': 'Search by code / name / reason / wallet...',
    'ابحث بكود أو اسم أو موبايل...': 'Search by code, name or phone...',
    'بحث في المناديب': 'Search couriers',
    'مسح البحث': 'Clear search',
    'مفيش مندوب بالبحث ده': 'No courier matches this search',
    'بحث': 'Search',
    'بحث في السلف': 'Search advances',
    'المندوب': 'Courier',
    'القسم': 'Section',
    'القسم والنوع': 'Section & type',
    'الشكوى': 'Complaint',
    'الشكوى والتفاصيل': 'Complaint & details',
    'ملاحظة للمندوب': 'Note for courier',
    'ملاحظة': 'Note',
    'الحالة': 'Status',
    'التقييم': 'Rating',
    'المبلغ': 'Amount',
    'السبب': 'Reason',
    'المحفظة': 'Wallet',
    'المبلغ (جنيه)': 'Amount (EGP)',
    'رقم المحفظة': 'Wallet number',
    'بتاريخ:': 'Date:',
    'وقت التسجيل': 'Created at',
    'مؤرشفة': 'Archived',
    'اكتب رد للمندوب...': 'Write a reply to the courier...',
    'رد للمندوب...': 'Reply to the courier...',
    'فتح بروفايل المندوب': 'Open courier profile',
    'استرجاع الشكوى للجدول الرئيسي': 'Restore the complaint to the main table',
    'استرجاع الشكوى': 'Restore complaint',
    'مسح الشكوى': 'Delete complaint',
    'مسح السلفة': 'Delete advance',
    'شافها': 'Seen',
    'مش شافها': 'Not seen',
    'المندوب فتح الشكوى بعد آخر رد': 'The courier opened the complaint after the last reply',
    'الرد لسه وصلش للمندوب': 'The reply has not reached the courier yet',

    // ===== لوحة الإدارة: مناديب وسلف =====
    'طلبات السلف': 'Advance requests',
    'التقرير الشهري': 'Monthly report',
    'التقرير الشهري للسلف': 'Monthly advances report',
    'تسجيل سلفة مصروفة': 'Record a paid advance',
    'إضافة / عرض المناديب': 'Add / list couriers',
    'كود المندوب (مثال: DAS-105)': 'Courier code (e.g. DAS-105)',
    'اسم المندوب الثلاثي': 'Full courier name',
    'رقم الموبايل': 'Mobile number',
    'حفظ المندوب': 'Save courier',
    'أو ارفع شيت المناديب (CSV فيه عمود Code وعمود Name) — إعادة الرفع بتحدّط الأسماء': 'Or upload the couriers sheet (CSV with a Code column and a Name column) — re-uploading updates the names',
    'رفع شيت CSV': 'Upload CSV sheet',
    'المناديب المسجلين': 'Registered couriers',
    'حفظ السلفة': 'Save advance',
    'سلفة جديدة': 'New advance',
    'السلفة اللي بتسجلها هنا بتتحدد على "تمت الصرف" تلقائي — طلبات المندوبين بتوصل من تاباتهم بـ"قيد المراجعة"': 'The advances you record here are set to "Paid" automatically — courier requests arrive in their tabs as "Under review"',
    'تمت الصرف': 'Paid',
    'مصروفة': 'Paid',
    'مرفوضة': 'Rejected',
    'عدد السلف': 'Number of advances',
    'إجمالي المصروف (ج)': 'Total paid (EGP)',
    'قيد المراجعة (ج)': 'Under review (EGP)',
    'المرفوض (ج)': 'Rejected (EGP)',
    'مصروف (ج)': 'Paid (EGP)',
    'مرفوض (ج)': 'Rejected (EGP)',
    'إجمالي السلف (ج)': 'Total advances (EGP)',
    'عدد السلف': 'Number of advances',
    'بروفايل المندوب': 'Courier profile',
    'مندوب غير معروف': 'Unknown courier',
    'إجمالي الشكاوى (شامل الأرشيف)': 'Total complaints (incl. archive)',
    'تحت المراجعة': 'Under review',
    'متوسط الرضا': 'Avg. satisfaction',
    'تقييمات ضعيفة (★2-)': 'Poor ratings (★2-)',
    'مفيش شكاوى': 'No complaints',
    'مفيش سلف': 'No advances',
    'لا توجد سلف': 'No advances',
    'مفيش سلف لسه —': 'No advances yet —',
    'مفيش سلف في الشهر ده': 'No advances this month',
    'اختار شهر تاني أو سجل سلف جديدة': 'Pick another month or record new advances',
    'طلبات المناديب هتظهر هنا، أو سجل سلفة صرفتها بنفسك': 'Courier requests show up here, or record an advance you paid yourself',
    'مفيش نتائج مطابقة': 'No matching results',
    'جرّب كلمة بحث مختلفة': 'Try a different search term',
    'لا توجد شكاوى مطابقة': 'No matching complaints',
    'جرّب تغيير الفلاتر أو البحث': 'Try changing the filters or the search',
    'الأرشيف فاضي': 'The archive is empty',
    'الشكاوى اللي اتحلت ومعدّي عليها 30 يوم بتنقل هنا تلقائي': 'Complaints resolved more than 30 days ago move here automatically',

    // ===== لوحة الإدارة: رسائل وتوست =====
    'شكوى جديدة من': 'New complaint from',
    'شكاوى جديدة': 'new complaints',
    'طلب سلفة جديد من': 'New advance request from',
    'طلبات سلف جديدة': 'new advance requests',
    'مندوب من الشيت': 'couriers from the sheet',
    'تم رفع/تحديث': 'Updated',
    'تم حفظ المندوب': 'Courier saved',
    'فشل حفظ المندوب': 'Failed to save the courier',
    'فشل رفع الشيت': 'Sheet upload failed',
    'تم حفظ التحديث': 'Update saved',
    'فشل الحفظ، حاول مرة أخرى': 'Save failed, try again',
    'تم مسح الشكوى': 'Complaint deleted',
    'فشل المسح، حاول مرة أخرى': 'Delete failed, try again',
    'تم مسح السلفة': 'Advance deleted',
    'رجعت الشكوى للجدول الرئيسي': 'The complaint is back in the main table',
    'فشل الاسترجاع، حاول مرة أخرى': 'Restore failed, try again',
    'تم تنزيل ملف الشكاوى': 'Complaints file downloaded',
    'تم تنزيل ملف السلف': 'Advances file downloaded',
    'تم تنزيل التقرير': 'Report downloaded',
    'مفيش شكاوى للتصدير بالفلاتر الحالية': 'No complaints to export with the current filters',
    'مفيش سلف للتصدير': 'No advances to export',
    'مفيش داتا للتصدير': 'No data to export',
    'تم تسجيل السلفة على حساب': 'Advance recorded as',
    'متأكد من مسح الشكوى دي نهائياً؟': 'Delete this complaint permanently?',
    'متأكد من مسح السلفة دي نهائياً؟': 'Delete this advance permanently?',

    // ===== الحضور من الروستر =====
    'الحضور — من سيستم الروستر': 'Attendance — from the roster system',
    'تسجيلات': 'Records',
    'حاضر': 'Present',
    'متأخر': 'Late',
    'غائب': 'Absent',
    'بعذر': 'Excused',
    'لم يُسجل': 'Not marked',
    'ج غرامات': 'EGP fines',
    'لايف — متصل بالروستر': 'Live — connected to the roster',
    'غير متصل بالروستر': 'Not connected to the roster',
    'مفيش تسجيلات في الأسبوع ده': 'No records this week',
    'سجّل الحضور من سيستم الروستر وهيظهر هنا لوحده': 'Record attendance in the roster system and it shows up here',
    'مش متطابق في الروستر': 'No match in the roster',
    'اتأكد إن كود الموظف في الروستر هو نفسه كود المندوب': 'Make sure the employee code in the roster is the same as the courier code',
    '— لو الكود مش موجود بيتطابق بالاسم بنفس الشكل': '— if there is no code it matches by name in the same way',
    'تعذر الاتصال بالروستر': 'Could not reach the roster',
    'ظبّط ROSTER_URL و ROSTER_ADMIN_PASSWORD من Variables على Railway': 'Set ROSTER_URL and ROSTER_ADMIN_PASSWORD in the Railway Variables',
    'الروستر مش مربوط — ظبّط ROSTER_URL و ROSTER_ADMIN_PASSWORD من Variables': 'The roster is not linked — set ROSTER_URL and ROSTER_ADMIN_PASSWORD in the Variables',
    'مفيش اتصال بالروستر دلوقتي — جرب تاني بعد ثواني': 'No connection to the roster right now — try again in a few seconds',
    'الروستر رد بخطأ': 'The roster returned an error',
    'فشل جلب موظفي الروستر': 'Failed to fetch the roster employees',

    // ===== رسائل السيرفر =====
    'محاولات كتير — استنى دقيقة وجرب تاني': 'Too many attempts — wait a minute and try again',
    'طلبات كتير — استنى شوية وجرب تاني': 'Too many requests — wait a bit and try again',
    'يرجى إدخال الكود': 'Please enter the code',
    'كود المندوب غير مسجل في السيستم': 'This courier code is not registered in the system',
    'يرجى ملء جميع البيانات المطلوبة': 'Please fill in all the required fields',
    'المبلغ غير صحيح': 'Invalid amount',
    'التقييم لازم يكون رقم من 1 لـ 5': 'The rating must be a number from 1 to 5',
    'الشكوى غير موجودة': 'Complaint not found',
    'الشكوى دي مش بتاعتك': 'This complaint is not yours',
    'مفيش تقييم غير بعد ما الشكوى تتحل': 'You can only rate after the complaint is resolved',
    'حالة غير معروفة': 'Unknown status',
    'السلفة غير موجودة': 'Advance not found',
    'غير مصرح — سجل دخول الإدارة الأول': 'Not authorized — sign in to the admin first',
    'الكود مسجل بالفعل — استخدم رفع الشيت لتحديث الاسم': 'This code is already registered — upload the sheet to update the name',
    'الملف فارغ': 'The file is empty',
    'فشل قراءة الملف. تأكد أنه ملف CSV بترميز صحيح': 'Could not read the file — make sure it is a CSV with the right encoding',
    'endpoint مطلوب': 'The endpoint is required',
    'إشعارات مش متفعلة على السيرفر': 'Notifications are not enabled on the server',
    'بيانات الاشتراك ناقصة': 'The subscription data is incomplete',
    'خطأ في السيرفر': 'Server error',
    'خطأ': 'Error',
    'خطأ في جلب البيانات': 'Error while fetching the data',
    'خطأ في حفظ المندوب': 'Error while saving the courier',
    'خطأ في حفظ المناديب': 'Error while saving the couriers',
    'فشل تسجيل الشكوى': 'Failed to create the complaint',
    'فشل حفظ السلفة': 'Failed to save the advance',
    'فشل تسجيل طلب السلفة': 'Failed to create the advance request',
    'فشل تسجيل الاشتراك': 'Failed to register the subscription',
    'فشل الإلغاء': 'Failed to unsubscribe',
    'فشل تحديث الحالة': 'Failed to update the status',
    'فشل تحديث السلفة': 'Failed to update the advance',
    'فشل حذف الشكوى': 'Failed to delete the complaint',
    'فشل مسح السلفة': 'Failed to delete the advance',
    'فشل جلب الشكاوى': 'Failed to fetch the complaints',
    'فشل جلب الأرشيف': 'Failed to fetch the archive',
    'فشل جلب السلف': 'Failed to fetch the advances',

    // ===== عناوين تصدير CSV =====
    'الكود': 'Code',
    'الاسم': 'Name',
    'النوع': 'Type',
    'تاريخ المشكلة': 'Issue date',
    'ملاحظة الإدارة': 'Admin note',
    'تعليق التقييم': 'Rating comment',
    'نص الشكوى': 'Complaint text',
    'التاريخ': 'Date',
    'الإجمالي': 'Total',

    // ===== عناوين التبويب =====
    'بوابة المناديب - DAS Portal': 'Courier Portal - DAS Portal',
    'لوحة الإدارة - DAS Admin': 'Admin Dashboard - DAS Admin',

    // ===== العملة =====
    'الأسبوع': 'Week',

    // ===== الكروت (صفحة المندوب + لوحة الإدارة) =====
    'إعلانات وتنبيهات': 'Announcements',
    'من الإدارة': 'From management',
    'إعلان': 'Notice',
    'دائم': 'Always on',
    'الكروت': 'Cards',
    'كروت صفحة المندوب': 'Courier page cards',
    'كارت جديد': 'New card',
    'كارت': 'card',
    'كروت': 'cards',
    'النشط فيهم': 'active',
    'الكارت': 'Card',
    'الجمهور': 'Audience',
    'الفترة': 'Period',
    'الحالة': 'Status',
    'تحكم': 'Actions',
    'نشط': 'Active',
    'متوقف': 'Paused',
    'تعديل': 'Edit',
    'إيقاف': 'Pause',
    'تشغيل': 'Resume',
    'مفيش كروت': 'No cards yet',
    'اضغط "كارت جديد" وازود أول كارت لصفحة المندوب': 'Click "New card" to add the first card for the courier page',
    'عنوان الكارت (مثال: ملاحظات التصريح)': 'Card title (e.g. clearance notes)',
    'نص الكارت... (اختياري)': 'Card body... (optional)',
    'نص الزرار (اختياري)': 'Button text (optional)',
    'رابط الزرار (اختياري)': 'Button URL (optional)',
    'مين يشوف الكارت؟': 'Who can see this card?',
    'كل المناديب': 'All couriers',
    'فرع معين (QCD 1 / QCD 2)': 'Specific branch (QCD 1 / QCD 2)',
    'فرع معين + نوع الدوام': 'Specific branch + employment type',
    'الفرع + نوع الدوام': 'Branch + employment type',
    'نوع الدوام (Full / Part time)': 'Employment type (Full / Part time)',
    'مناديب معينين بالكود': 'Specific couriers by code',
    'الفرع': 'Branch',
    'نوع الدوام': 'Employment type',
    'دوام كامل (Full time)': 'Full time',
    'دوام جزئي (Part time)': 'Part time',
    'أكواد المناديب (فاصلة بينهم)': 'Courier codes (comma separated)',
    'أكواد محددة': 'Selected codes',
    'كود': 'codes',
    'هيظهر لكل المناديب المسجلين من غير شرط إضافي': 'Shown to all registered couriers — no extra condition',
    'الكارت هيظهر في بداية صفحة المندوب بس لو كان نشط وفي فترته ومطابق للجمهور — الفرع ونوع الدوام بيتحددوا من الروستر': 'The card shows at the top of the courier page only if it is active, within its period, and matches the audience — branch & employment type come from the roster',
    'يظهر من (اختياري)': 'Visible from (optional)',
    'لحد (اختياري)': 'Visible until (optional)',
    'الكارت نشط (ظاهر للمندوبين)': 'Card is active (visible to couriers)',
    'حفظ الكارت': 'Save card',
    'حفظ التعديل': 'Save changes',
    'تعديل الكارت': 'Edit card',
    'الكارت اتعدل': 'Card updated',
    'الكارت اتسجل وبقى ظاهر حسب شروطه': 'Card saved — it now shows as scheduled',
    'الكارت اتشغل': 'Card is on',
    'الكارت اتوقف — مش هيظهر لحد ما تشغله': 'Card paused — it stays hidden until you resume it',
    'الكارت اتمسح': 'Card deleted',
    'فشل حفظ الكارت': 'Failed to save the card',
    'فشل تحديث الكارت': 'Failed to update the card',
    'فشل مسح الكارت': 'Failed to delete the card',
    'متأكد من مسح الكارت ده نهائياً؟': 'Delete this card permanently?',
    'فشل حفظ ترتيب الكروت': 'Failed to save the card order',
    'الترتيب اتحدث': 'Order updated',
    // الخيارات التفاعلية (تصويت)
    'خيارات تفاعلية (اختياري)': 'Interactive options (optional)',
    'زود اختيار': 'Add option',
    'نص الاختيار (اختياري)': 'Option text (optional)',
    'لو هتحط خيارات، حط اتنين على الأقل': 'If you add options, add at least two',
    'أقصى 8 اختيارات في الكارت': 'Maximum 8 options per card',
    'لو حطيت اختيارات — الكارت بيبقى قابل للتصويت: كل مندوب يدوس على اختياره وانت تشوف مين اختار إيه في واجهة الكارت': 'With options the card becomes votable: each courier taps their choice and you see who picked what on the card',
    'الأصوات': 'Votes',
    'تفاعلي': 'Interactive',
    'صوّتوا': 'voted',
    'مناديب': 'couriers',
    'مندوب': 'courier',
    'صوت جديد على': 'New vote on',
    'لسه مفيش حدا اختارها': 'Nobody picked this yet',
    'لسه مفيش أصوات': 'No votes yet',
    'دوس على اختيارك': 'Tap your choice',
    'تسجل اختيارك': 'Your choice is saved',
    'فشل تسجيل اختيارك': 'Failed to save your choice',
    'بيانات الصوت ناقصة': 'Missing vote data',
    'اختيار غير موجود': 'Unknown option',
    'الكارت غير موجود أو متوقف': 'Card not found or paused',
    'اسحب الكارت من أي مكان وارميه مكانه عشان تترتيب طريقة ظهورهم للمندوب': 'Drag any card to reorder how they appear on the courier page',
    'فرع': 'Branch',
    'دوام كامل': 'Full time',
    'دوام جزئي': 'Part time',
    'من': 'from',
    'لحد': 'until',
    'معاينة — كذا الكارت هيظهر للمندوب': 'Live preview — as the courier sees it',
    'قوالب جاهزة': 'Ready templates',
    'زرار جاهز': 'Ready buttons',
    'دوس على أي قالب عشان يبعت العنوان والنص — عدلهم بعدها زي ما تحب': 'Click a template to fill the title & body — tweak afterwards',
    'دوس على أي زرار جاهز عشان يملا نص الزرار ورابطه': 'Click a ready button to fill the button text & URL',
    'بريك جديد': 'Break update',
    'البريك اليوم من ... لـ ...': 'Today\'s break is shifting from ... to ...',
    'عطل مؤقت': 'Temporary outage',
    'فيه عطل في ... — بنشتغل عليه حالًا ونبلغكم بالتحديث': 'There is an outage in ... — we are on it and will update you shortly',
    'تنبيه عام': 'General notice',
    'لازم كل المناديب ...': 'All couriers must ...',
    'ملاحظة مهمة': 'Important note',
    'اتفضل اقرأ الملاحظة دي كويس قبل الشيفت': 'Please read this note carefully before your shift',
    'واتساب': 'WhatsApp',
    'اتصل بنا': 'Call us',
    'الاوقات': 'Timings',
    'الجدول': 'Schedule',
    'افتح': 'Open',
    'عنوان الكارت': 'Card title',
    'فتح': 'Open',
    'English / عربي': 'English / Arabic',

    // ===== قسم مزامنة الروستر (DAS ⇄ الروستر) =====
    'مزامنة الروستر': 'Roster sync',
    'كل الأفرع': 'All branches',
    'مندوبين مالهمش فرع في الروستر': 'Couriers with no branch in the roster',
    'الروستر مش مربوط — الفلتر مش هيشتغل': 'Roster not connected — the filter is disabled',
    'جاري تحميل الأفرع…': 'Loading branches…',
    'شكوى بدون فرع في الروستر': 'complaints with no branch in the roster',
    'سلفة بدون فرع في الروستر': 'advances with no branch in the roster',
    'شكاوى لسه مفتوحة': 'Open complaints',
    'سلف مردتش عليها': 'Unanswered advances',
    'كروت اتجاوب عليها': 'Cards with replies',
    'مزامنة مناديب DAS مع الروستر': 'Sync DAS couriers with the roster',
    'تحديث': 'Refresh',
    'تطبيق المحدد': 'Apply selected',
    'محتاج تعديل': 'Needs update',
    'محتاج تأكيد': 'Needs confirmation',
    'غير موجود': 'Not found',
    'موجود بس في الروستر': 'Only in the roster',
    'تحديد المطابقات': 'Select matches',
    'إلغاء التحديد': 'Clear selection',
    'ابحث بكود أو اسم...': 'Search by code or name...',
    'كود DAS': 'DAS code',
    'اسم DAS': 'DAS name',
    'كود الروستر': 'Roster code',
    'اسم الروستر': 'Roster name',
    'المطابقة': 'Match',
    'التغيير': 'Change',
    'مطابق': 'Matched',
    'مطابق بالكود': 'Matched by code',
    'مطابق بالاسم': 'Matched by name',
    'غير موجود في الروستر': 'Not in the roster',
    'الكود مستخدم في موظف تاني': 'Code already used by another employee',
    'مش موجود في DAS': 'Not in DAS',
    'مفيش تغيير': 'No changes',
    'مفيش نتائج': 'No results',
    'الروستر مش مربوط': 'Roster not connected',
    'مفيش تحديثات مختارة': 'No updates selected',
    'فشل تحميل بيانات المزامنة': 'Failed to load sync data',
    'فشل تطبيق التحديثات': 'Failed to apply updates',
    'مفيش اتصال بالسيرفر': 'Cannot reach the server',
    'مفيش اتصال بالروستر دلوقتي — جرب تاني بعد ثواني': 'No connection to the roster right now — try again in a few seconds',
    'اتحدّث': 'Updated',
    'هتعدّل': 'You will update',
    'موظف في الروستر بالاسم والكود من DAS': 'employee in the roster with the name and code from DAS',
    'تطبيق التعديل على هذا الموظف': 'Apply the update to this employee',
    'وتانيين كمان': 'and others',
    'انتهت الجلسة — سجل دخول تاني': 'Session expired — sign in again',
    'تأكيد؟': 'Confirm?'
  };

  const EN2AR = {};
  Object.keys(DICT).forEach(function (ar) {
    const en = DICT[ar];
    if (!(en in EN2AR) || ar.length > EN2AR[en].length) EN2AR[en] = ar;
  });

  // الترتيب بالطول عشان الجمل الطويلة (اللي فيها جمل أقصر) تترجم الأول
  const AR_EN = Object.keys(DICT).map(function (k) { return [k, DICT[k]]; }).sort(function (a, b) { return b[0].length - a[0].length; });
  const EN_AR = Object.keys(DICT).map(function (k) { return [DICT[k], k]; }).sort(function (a, b) { return b[0].length - a[0].length; });

  const HAS_AR = /[\u0600-\u06FF]/;
  const HAS_LATIN = /[A-Za-z]/;

  // حدود الكلمة: الكلمة العربية ماتترجمش وهي جزء من كلمة تانية (مثل "تقييم" جوه "التقييم")
  const AR_RANGE = '\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF';
  const AR_CHAR_RE = new RegExp('[' + AR_RANGE + ']');

  function buildPattern(key) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pre = AR_CHAR_RE.test(key.charAt(0)) ? '(?<![' + AR_RANGE + '])' : '';
    const post = AR_CHAR_RE.test(key.charAt(key.length - 1)) ? '(?![' + AR_RANGE + '])' : '';
    return new RegExp(pre + esc + post, 'g');
  }

  AR_EN.forEach(function (p) { p[2] = buildPattern(p[0]); });
  EN_AR.forEach(function (p) { p[2] = buildPattern(p[0]); });

  // العملة: "500 ج" ⇄ "500 EGP" — والـ ج لازم ما تكونش أول كلمة (عشان "جولة" ماتتأثرش)
  const CUR_TO_EN = /(\d+(?:\.\d+)?)\s*ج(?![؀-ۿ])/g;
  const CUR_TO_AR = /(\d+(?:\.\d+)?)\s*EGP(?![A-Za-z])/g;

  let lang = 'ar';
  let titleOrig = '';
  const cache = new Map();
  const textOrig = new WeakMap();
  const attrOrig = new WeakMap();
  const i18nWritten = new WeakMap();

  function translateWith(str, pairs) {
    let out = str;
    for (let i = 0; i < pairs.length; i++) {
      if (out.indexOf(pairs[i][0]) === -1) continue;
      out = out.replace(pairs[i][2], function () { return pairs[i][1]; });
    }
    return out;
  }

  function T(input) {
    if (input == null) return input;
    const str = String(input);
    if (!str) return str;
    const hit = cache.get(str);
    if (hit !== undefined) return hit;
    let out;
    if (lang === 'en') {
      out = Object.prototype.hasOwnProperty.call(DICT, str) ? DICT[str]
        : (HAS_AR.test(str) ? translateWith(str, AR_EN) : str);
      out = out.replace(CUR_TO_EN, function (m, n) { return n + ' EGP'; });
    } else {
      out = Object.prototype.hasOwnProperty.call(EN2AR, str) ? EN2AR[str]
        : (HAS_LATIN.test(str) ? translateWith(str, EN_AR) : str);
      out = out.replace(CUR_TO_AR, function (m, n) { return n + ' ج'; });
    }
    if (cache.size > 8000) cache.clear();
    cache.set(str, out);
    return out;
  }

  function isRaw(node) {
    let n = node;
    while (n && n.nodeType === 1) {
      if (n.hasAttribute('data-i18n-raw')) return true;
      n = n.parentNode;
    }
    return false;
  }

  function translateAttrs(el) {
    const attrs = ['placeholder', 'title', 'aria-label', 'data-label'];
    // السمات اللي عليها data-i18n-* بتترجم من الوسم نفسه، فمش بنخليها تتترجم تاني
    const explicit = {
      'placeholder': el.hasAttribute('data-i18n-placeholder'),
      'title': el.hasAttribute('data-i18n-title'),
      'aria-label': el.hasAttribute('data-i18n-aria')
    };
    let store = attrOrig.get(el);
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (explicit[a]) continue;
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      if (!store) { store = {}; attrOrig.set(el, store); }
      if (store[a] === undefined) store[a] = cur;
      const out = T(store[a]);
      if (cur !== out) el.setAttribute(a, out);
    }
  }

  function translateElement(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.hasAttribute('data-i18n-raw')) return;
    const ph = el.getAttribute('data-i18n-placeholder');
    if (ph !== null) el.setAttribute('placeholder', T(ph));
    const ti = el.getAttribute('data-i18n-title');
    if (ti !== null) el.setAttribute('title', T(ti));
    const ar = el.getAttribute('data-i18n-aria');
    if (ar !== null) el.setAttribute('aria-label', T(ar));
    const key = el.getAttribute('data-i18n');
    // العنصر اللي عليه data-i18n بياخد النص من الوسم نفسه — إلا لو الكود غيّره بعدين
    if (key !== null && !el.children.length) {
      const cur = el.textContent;
      const last = i18nWritten.get(el);
      const src = (last !== undefined && cur !== last) ? cur : key;
      const out = T(src);
      if (cur !== out) el.textContent = out;
      i18nWritten.set(el, out);
      return;
    }
    translateAttrs(el);
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) translateNode(kids[i]);
  }

  function translateNode(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      const p = node.parentNode;
      if (!p || p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.nodeName === 'NOSCRIPT') return;
      if (isRaw(p)) return;
      let orig = textOrig.get(node);
      if (orig === undefined) { orig = node.nodeValue; textOrig.set(node, orig); }
      const out = T(orig);
      if (node.nodeValue !== out) node.nodeValue = out;
    } else if (node.nodeType === 1) {
      translateElement(node);
    }
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateNode(root); return; }
    if (root.nodeType === 1) translateElement(root);
  }

  function setLang(next) {
    lang = (next === 'en') ? 'en' : 'ar';
    DAS.lang = lang;
    cache.clear();
    try { localStorage.setItem('das_lang', lang); } catch (e) {}
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = T(titleOrig);
    translateTree(document.body);
    // الصفحات بتسمع الحدث ده وتعيد رندر الجداول والتواريخ بلغة العرض
    document.dispatchEvent(new CustomEvent('das:lang', { detail: { lang: lang } }));
  }

  // أي نص بيتولّد بالجافاسكريبت (صفوف جدول، كارت، توست) بيترجم أوتوماتيك
  const observer = new MutationObserver(function (records) {
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (rec.type === 'characterData') {
        translateNode(rec.target);
      } else {
        for (let j = 0; j < rec.addedNodes.length; j++) translateNode(rec.addedNodes[j]);
      }
    }
  });

  window.DAS = window.DAS || {};
  DAS.lang = lang;
  DAS.t = T;
  DAS.setLang = setLang;
  DAS.toggleLang = function (l) {
    setLang(l || (lang === 'en' ? 'ar' : 'en'));
  };

  // flip الاتجاه بدري قبل ما الصفحة ترندر عشان مفيش وميض
  try {
    if (localStorage.getItem('das_lang') === 'en') {
      lang = 'en';
      DAS.lang = 'en';
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
    }
  } catch (e) {}

  document.addEventListener('DOMContentLoaded', function () {
    titleOrig = document.title;
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    let saved = null;
    try { saved = localStorage.getItem('das_lang'); } catch (e) {}
    if (saved === 'en') setLang('en');
    else translateTree(document.body);
  });
})();
