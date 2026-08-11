/** 播客摘要 */
export interface Podcast {
  id: string;
  name: string;
  cover?: string;
  description?: string;
  creator?: string;
  programCount: number;
  createTime?: number;
  updateTime?: number;
}
