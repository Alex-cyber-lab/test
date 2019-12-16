# test

This is test task for Node.js

Create http-server on base framework koa2 with this requirments:
1. Work with MySQL. In db contain table books with 1e5 records. Work with clear SQL, not a ORM or Query Builder
2. Contains 3 controlers:
2.1 Add records to db
2.2 Return data. Need sort and filtering in any field with offset and limit
2.3 Change

INSTALL

1. git clone https://github.com/Alex-cyber-lab/test.git
2. set params to "my_sql_connection" in "config/default.json"
3. start command "node app.js"
4. follow the console instructions

API
Path - "/books"

Method - GET
Query parameters example:
where: {"title":"The Odyssey 66"} // For where using 1 field (title, author, description, image)
date: {"from":"2000-01-21","to":"2005-07-22"} // Date only ISO8601
orderby: {"id":"ASC","title":"DESC"} // Any fields
offset: 0 *
limit: 10 *

Method - POST
Body form-data example:
title: "Book title" * 
date: "2028-08-20" * 
author: "Author name" *
description: "This book is published..." *
image: "set path to default png image" *

Method - PUT
Body form-data example:
id: 1 *
title: "Book title"
date: "2028-08-20"
author: "Author name"
description: "This book is published..."
image: "set path to default png image"

* - required field
