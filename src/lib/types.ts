export type GardenDraft = {
  gardenId: string;
  imageName?: string;
  imagePreview?: string;
  status: 'empty' | 'ready' | 'sent' | 'duplicate' | 'failed';
  message?: string;
};

export type SubmissionPayload = {
  projectId: string;
  managerName: string;
  submittedAt: string;
  records: GardenDraft[];
};
