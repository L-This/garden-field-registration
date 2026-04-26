export type Project = {
  id: string;
  name: string;
  district: string;
  contractorLabel: string;
  accent: string;
};

export const projects: Project[] = [
  {
    id: 'briman',
    name: 'مشروع بريمان وطيبة',
    district: 'نطاق شمال شرق جدة',
    contractorLabel: 'مدير المشروع',
    accent: 'emerald',
  },
  {
    id: 'omalsalam',
    name: 'مشروع ام السلم ابرق الرغامة',
    district: 'الأحياء الشرقية',
    contractorLabel: 'مدير المشروع',
    accent: 'teal',
  },
  {
    id: 'private',
    name: 'مشروع المخططات الخاصة',
    district: 'الأحياء الجنوبية',
    contractorLabel: 'مدير المشروع',
    accent: 'blue',
  },
  {
    id: 'jangel',
    name: 'مشروع الغابة الشرقية',
    district: 'الغابة الشرقية',
    contractorLabel: 'مدير المشروع',
    accent: 'green',
  },
];

export function getProject(projectId: string) {
  return projects.find((project) => project.id === projectId);
}
