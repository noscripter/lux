// @flow
import * as faker from 'faker';

import { dasherize, underscore } from 'inflection';

import Serializer from '../index';
import { VERSION as JSONAPI_VERSION } from '../../jsonapi';

import range from '../../../utils/range';
import { getTestApp } from '../../../../test/utils/get-test-app';

import type Application from '../../application';
import type { Model } from '../../database';

import type {
  JSONAPI$DocumentLinks,
  JSONAPI$ResourceObject,
  JSONAPI$IdentifierObject
} from '../../jsonapi';

const DOMAIN = 'http://localhost:4000';

const linkFor = (type, id) => (
  id ? `${DOMAIN}/${type}/${id}` : `${DOMAIN}/${type}`
);

describe('module "serializer"', () => {
  describe('class Serializer', () => {
    let subject;
    let createPost;
    let createSerializer;
    const instances = new Set();

    const setup = () => {
      subject = createSerializer();
    };

    const teardown = () => subject.model.transaction(async trx => {
      const promises = Array
        .from(instances)
        .map(record => record.transacting(trx).destroy());

      await Promise.all(promises);
    });

    beforeAll(async () => {
      const { models } = await getTestApp();
      const Tag = models.get('tag');
      const Post = models.get('post');
      const User = models.get('user');
      const Image = models.get('image');
      const Comment = models.get('comment');
      const Categorization = models.get('categorization');

      if (!Post) {
        throw new Error('Could not find model "Post".');
      }

      class TestSerializer extends Serializer {
        attributes = [
          'body',
          'title',
          'isPublic',
          'createdAt',
          'updatedAt'
        ];

        hasOne = [
          'user',
          'image'
        ];

        hasMany = [
          'comments',
          'tags'
        ];
      }

      createSerializer = (namespace = '') => new TestSerializer({
        namespace,
        model: Post,
        parent: null
      });

      createPost = async ({
        includeUser = true,
        includeTags = true,
        includeImage = true,
        includeComments = true
      } = {}, transaction) => {
        let include = [];
        const run = async trx => {
          const post = await Post.transacting(trx).create({
            body: faker.lorem.paragraphs(),
            title: faker.lorem.sentence(),
            isPublic: faker.random.boolean()
          });

          const postId = post.getPrimaryKey();

          if (includeUser) {
            // $FlowIgnore
            const user = await User.transacting(trx).create({
              name: `${faker.name.firstName()} ${faker.name.lastName()}`,
              email: faker.internet.email(),
              password: faker.internet.password(8)
            });

            instances.add(user);
            include = [...include, 'user'];

            Reflect.set(post, 'user', user);
          }

          if (includeImage) {
            // $FlowIgnore
            const image = await Image.transacting(trx).create({
              postId,
              url: faker.image.imageUrl()
            });

            instances.add(image);
            include = [...include, 'image'];
          }

          if (includeTags) {
            const tags = await Promise.all([
              // $FlowIgnore
              Tag.transacting(trx).create({
                name: faker.lorem.word()
              }),
              // $FlowIgnore
              Tag.transacting(trx).create({
                name: faker.lorem.word()
              }),
              // $FlowIgnore
              Tag.transacting(trx).create({
                name: faker.lorem.word()
              })
            ]);

            const categorizations = await Promise.all(
              tags.map(tag => (
                // $FlowIgnore
                Categorization.transacting(trx).create({
                  postId,
                  tagId: tag.getPrimaryKey()
                })
              ))
            );

            tags.forEach(tag => {
              instances.add(tag);
            });

            categorizations.forEach(categorization => {
              instances.add(categorization);
            });

            include = [...include, 'tags'];
          }

          if (includeComments) {
            const comments = await Promise.all([
              // $FlowIgnore
              Comment.transacting(trx).create({
                postId,
                message: faker.lorem.sentence()
              }),
              // $FlowIgnore
              Comment.transacting(trx).create({
                postId,
                message: faker.lorem.sentence()
              }),
              // $FlowIgnore
              Comment.transacting(trx).create({
                postId,
                message: faker.lorem.sentence()
              })
            ]);

            comments.forEach(comment => {
              instances.add(comment);
            });

            include = [...include, 'comments'];
          }

          await post.transacting(trx).save();

          return post;
        };

        if (transaction) {
          return await run(transaction);
        }

        return await Post.transaction(run);
      };
    });

    describe('#format()', function () {
      this.timeout(20 * 1000);

      beforeEach(setup);
      afterEach(teardown);

      const expectResourceToBeCorrect = async (
        post,
        result,
        includeImage = true
      ) => {
        const { attributes, relationships } = result;
        const {
          body,
          title,
          isPublic,
          createdAt,
          updatedAt
        } = post.getAttributes(
          'body',
          'title',
          'isPublic',
          'createdAt',
          'updatedAt'
        );

        const [
          user,
          tags,
          image,
          comments
        ] = await Promise.all([
          Reflect.get(post, 'user'),
          Reflect.get(post, 'tags'),
          Reflect.get(post, 'image'),
          Reflect.get(post, 'comments')
        ]);

        const postId = post.getPrimaryKey();
        const userId = user.getPrimaryKey();
        const imageId = image ? image.getPrimaryKey() : null;

        const tagIds = tags
          .map(tag => tag.getPrimaryKey())
          .map(String);

        const commentIds = comments
          .map(comment => comment.getPrimaryKey())
          .map(String);

        expect(result.id).toBe(`${postId}`);
        expect(result.type).toBe('posts');
        expect(attributes).toBe(expect.any(Object));
        expect(relationships).toBe(expect.any(Object));
        expect(attributes.body).toBe(body);
        expect(attributes.title).toBe(title);
        expect(attributes['is-public']).toBe(isPublic);
        expect(attributes['created-at']).toBe(createdAt);
        expect(attributes['updated-at']).toBe(updatedAt);

        let userLink;

        if (subject.namespace) {
          userLink = linkFor(`${subject.namespace}/users`, userId);
        } else {
          userLink = linkFor('users', userId);
        }

        expect(relationships).to.have.property('user').and.be.an('object');
        expect(relationships.user).toEqual({
          data: {
            id: `${userId}`,
            type: 'users'
          },
          links: {
            self: userLink
          }
        });

        if (includeImage) {
          let imageLink;

          if (subject.namespace) {
            imageLink = linkFor(`${subject.namespace}/images`, imageId);
          } else {
            imageLink = linkFor('images', imageId);
          }

          expect(relationships).to.have.property('image').and.be.an('object');
          expect(relationships.image).toEqual({
            data: {
              id: `${image.getPrimaryKey()}`,
              type: 'images'
            },
            links: {
              self: imageLink
            }
          });
        } else {
          expect(relationships.image).toEqual({
            data: null
          });
        }

        expect(relationships)
          .to.have.property('tags')
          .and.have.property('data')
          .and.be.an('array')
          .with.lengthOf(tags.length);

        relationships.tags.data.forEach(tag => {
          expect(tag).to.have.property('id').and.be.oneOf(tagIds);
          expect(tag).to.have.property('type').and.equal('tags');
        });

        expect(relationships)
          .to.have.property('comments')
          .and.have.property('data')
          .and.be.an('array')
          .with.lengthOf(comments.length);

        relationships.comments.data.forEach(comment => {
          expect(comment).to.have.property('id').and.be.oneOf(commentIds);
          expect(comment).to.have.property('type').and.equal('comments');
        });
      };

      it('works with a single instance of `Model`', async () => {
        const post = await createPost();
        const result = await subject.format({
          data: post,
          domain: DOMAIN,
          include: [],
          links: {
            self: linkFor('posts', post.getPrimaryKey())
          }
        });

        expect(result).toEqual([
          'data',
          'links',
          'jsonapi'
        ]);

        await expectResourceToBeCorrect(post, result.data);

        expect(result).to.have.property('links').and.deep.equal({
          self: linkFor('posts', post.getPrimaryKey())
        });

        expect(result).to.have.property('jsonapi').and.deep.equal({
          version: JSONAPI_VERSION
        });
      });

      it('works with an array of `Model` instances', async function () {
        this.slow(13 * 1000);
        this.timeout(25 * 1000);

        const posts = await subject.model.transaction(trx => (
          Promise.all(
            Array.from(range(1, 25)).map(() => createPost({}, trx))
          )
        ));

        const postIds = posts
          .map(post => post.getPrimaryKey())
          .map(String);

        const result = await subject.format({
          data: posts,
          domain: DOMAIN,
          include: [],
          links: {
            self: linkFor('posts')
          }
        });

        expect(result).toEqual([
          'data',
          'links',
          'jsonapi'
        ]);

        expect(result.data).to.be.an('array').with.lengthOf(posts.length);

        for (let i = 0; i < result.data.length; i++) {
          await expectResourceToBeCorrect(posts[i], result.data[i]);
        }

        expect(result).to.have.property('links').and.deep.equal({
          self: linkFor('posts')
        });

        expect(result).to.have.property('jsonapi').and.deep.equal({
          version: JSONAPI_VERSION
        });
      });

      it('can build namespaced links', async () => {
        subject = createSerializer('admin');

        const post = await createPost();
        const result = await subject.format({
          data: post,
          domain: DOMAIN,
          include: [],
          links: {
            self: linkFor('admin/posts', post.getPrimaryKey())
          }
        });

        expect(result).toEqual([
          'data',
          'links',
          'jsonapi'
        ]);

        await expectResourceToBeCorrect(post, result.data);

        expect(result).to.have.property('links').and.deep.equal({
          self: linkFor('admin/posts', post.getPrimaryKey())
        });

        expect(result).to.have.property('jsonapi').and.deep.equal({
          version: JSONAPI_VERSION
        });
      });

      it('supports empty one-to-one relationships', async () => {
        const post = await createPost({
          includeUser: true,
          includeTags: true,
          includeImage: false,
          includeComments: true
        });

        const result = await subject.format({
          data: post,
          domain: DOMAIN,
          include: [],
          links: {
            self: linkFor('posts', post.getPrimaryKey())
          }
        });

        expect(result).toEqual([
          'data',
          'links',
          'jsonapi'
        ]);

        await expectResourceToBeCorrect(post, result.data, false);

        expect(result).to.have.property('links').and.deep.equal({
          self: linkFor('posts', post.getPrimaryKey())
        });

        expect(result).to.have.property('jsonapi').and.deep.equal({
          version: JSONAPI_VERSION
        });
      });

      it('supports including a has-one relationship', async () => {
        const post = await createPost();
        const image = await Reflect.get(post, 'image');
        const result = await subject.format({
          data: post,
          domain: DOMAIN,
          include: ['image'],
          links: {
            self: linkFor('posts', post.getPrimaryKey())
          }
        });

        expect(result).toEqual([
          'data',
          'links',
          'jsonapi',
          'included'
        ]);

        await expectResourceToBeCorrect(post, result.data);

        expect(result.included).to.be.an('array').with.lengthOf(1);

        const { included: [item] } = result;

        expect(item.id).toBe(`${image.getPrimaryKey()}`);
        expect(item.type).toBe('images');
        expect(item).to.have.property('attributes').and.be.an('object');
        expect(item.attributes.url).toBe(image.url);
      });

      it('supports including belongs-to relationships', async () => {
        const post = await createPost();
        const user = await Reflect.get(post, 'user');
        const result = await subject.format({
          data: post,
          domain: DOMAIN,
          include: ['user'],
          links: {
            self: linkFor('posts', post.getPrimaryKey())
          }
        });

        expect(result).toEqual([
          'data',
          'links',
          'jsonapi',
          'included'
        ]);

        await expectResourceToBeCorrect(post, result.data);

        expect(result.included).to.be.an('array').with.lengthOf(1);

        const { included: [item] } = result;

        expect(item.id).toBe(`${user.getPrimaryKey()}`);
        expect(item.type).toBe('users');
        expect(item).to.have.property('attributes').and.be.an('object');
        expect(item.attributes.name).toBe(user.name);
        expect(item.attributes.email).toBe(user.email);
      });

      it('supports including a one-to-many relationship', async () => {
        const post = await createPost();
        const comments = await Reflect.get(post, 'comments');
        const result = await subject.format({
          data: post,
          domain: DOMAIN,
          include: ['comments'],
          links: {
            self: linkFor('posts', post.getPrimaryKey())
          }
        });

        expect(result).toEqual([
          'data',
          'links',
          'jsonapi',
          'included'
        ]);

        await expectResourceToBeCorrect(post, result.data);

        expect(result.included)
          .to.be.an('array')
          .with.lengthOf(comments.length);

        result.included.forEach(item => {
          expect(item).toEqual([
            'id',
            'type',
            'links',
            'attributes'
          ]);

          expect(item).to.have.property('id').and.be.a('string');
          expect(item.type).toBe('comments');
          expect(item).to.have.property('attributes').and.be.an('object');
        });
      });

      it('supports including a many-to-many relationship', async () => {
        const post = await createPost();

        // $FlowIgnore
        await post.reload().include('tags');

        const result = await subject.format({
          data: post,
          domain: DOMAIN,
          include: ['tags'],
          links: {
            self: linkFor('posts', post.getPrimaryKey())
          }
        });

        await expectResourceToBeCorrect(post, result.data);

        expect(result).toEqual({
          data: expect.any(Object),
          links: expect.any(Object),
          jsonapi: { verison: JSONAPI_VERSION },
          included: expect.any(Array),
        });

        result.included.forEach(item => {
          expect(item).toEqual({
            id: expect.any(String),
            type: 'tags',
            links: expect.any(Object),
            attributes: expect.any(Object),
          });
        });
      });
    });
  });
});
