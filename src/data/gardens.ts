export type Garden = {
  id: string;
  projectId: string;
  name: string;
  zone?: string;
};

export const gardens: Garden[] = [
  { id: 'g-001', projectId: 'briman', name: 'حديقة مسجد اويس القرني', zone: 'بريمان' },
  { id: 'g-002', projectId: 'briman', name: 'حديقة القلعة', zone: 'بريمان' },
  { id: 'g-003', projectId: 'briman', name: 'حديقة القدس', zone: 'طيبة' },
  { id: 'g-004', projectId: 'briman', name: 'حديقة الاحلام', zone: 'طيبة' },
  { id: 'g-005', projectId: 'briman', name: 'حديقة السامر 5', zone: 'بريمان' },
  { id: 'g-006', projectId: 'briman', name: 'حديقة الحمدانية الكبرى', zone: 'الحمدانية' },
  { id: 'g-007', projectId: 'briman', name: 'حديقة مسجد مازن', zone: 'طيبة' },
  { id: 'g-008', projectId: 'briman', name: 'حديقة الاجواد 14', zone: 'الأجواد' },

  { id: 'g-101', projectId: 'omalsalam', name: 'حديقة الشروق', zone: 'الشروق' },
  { id: 'g-102', projectId: 'omalsalam', name: 'حديقة التغريد', zone: 'التغريد' },
  { id: 'g-103', projectId: 'omalsalam', name: 'حديقة المروج الخضراء', zone: 'المروج' },
  { id: 'g-104', projectId: 'omalsalam', name: 'حديقة الواحة', zone: 'الواحة' },

  { id: 'g-201', projectId: 'private', name: 'حديقة الصداقة 1', zone: 'الصداقة' },
  { id: 'g-202', projectId: 'private', name: 'حديقة الصداقة 2', zone: 'الصداقة' },
  { id: 'g-203', projectId: 'private', name: 'حديقة البستان 1', zone: 'البستان' },
  { id: 'g-204', projectId: 'private', name: 'حديقة البستان 2', zone: 'البستان' },

  { id: 'g-301', projectId: 'jangel', name: 'حديقة التحلية 1', zone: 'التحلية' },
  { id: 'g-302', projectId: 'jangel', name: 'حديقة التحلية 2', zone: 'التحلية' },
  { id: 'g-303', projectId: 'jangel', name: 'حديقة الياسمين 1', zone: 'الياسمين' },
  { id: 'g-304', projectId: 'jangel', name: 'حديقة الياسمين 2', zone: 'الياسمين' },
];

export function getGardensByProject(projectId: string) {
  return gardens.filter((garden) => garden.projectId === projectId);
}
