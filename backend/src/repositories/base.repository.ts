import type {
  FilterQuery,
  Model,
  PipelineStage,
  QueryOptions,
  UpdateQuery,
} from 'mongoose';

export interface PageOptions {
  page?: number;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Thin query wrapper shared by every collection. Business rules and state
 * machines live in services — repositories only talk to Mongo.
 */
export class BaseRepository<T> {
  constructor(protected readonly model: Model<T>) {}

  get raw(): Model<T> {
    return this.model;
  }

  findById(id: string): Promise<T | null> {
    return this.model.findById(id).lean<T>().exec();
  }

  findOne(filter: FilterQuery<T>): Promise<T | null> {
    return this.model.findOne(filter).lean<T>().exec();
  }

  find(filter: FilterQuery<T>, options: QueryOptions = {}): Promise<T[]> {
    return this.model.find(filter, null, options).lean<T[]>().exec();
  }

  count(filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  async paginate(
    filter: FilterQuery<T>,
    { page = 1, limit = 20 }: PageOptions = {},
    options: QueryOptions = {},
  ): Promise<Page<T>> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const [items, total] = await Promise.all([
      this.model
        .find(filter, null, options)
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean<T[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, page: safePage, limit: safeLimit, total };
  }

  insert(doc: Partial<T>): Promise<T> {
    return this.model.create(doc) as unknown as Promise<T>;
  }

  updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>): Promise<boolean> {
    return this.model.updateOne(filter, update).then((result) => result.matchedCount > 0);
  }

  findOneAndUpdate(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options: QueryOptions = { new: true },
  ): Promise<T | null> {
    return this.model.findOneAndUpdate(filter, update, options).lean<T>().exec();
  }

  deleteOne(filter: FilterQuery<T>): Promise<boolean> {
    return this.model.deleteOne(filter).then((result) => result.deletedCount > 0);
  }

  aggregate<R = Record<string, unknown>>(pipeline: PipelineStage[]): Promise<R[]> {
    return this.model.aggregate<R>(pipeline).exec();
  }
}
